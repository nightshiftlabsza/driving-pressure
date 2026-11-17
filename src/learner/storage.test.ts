import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage, IndexedDbStorage } from './storage';
import { createLearner } from './learner';
import type { LearnerEvent } from '../shared/events';

describe('Storage adapters', () => {
  const sampleEvent: LearnerEvent = {
    v: 1,
    id: 'evt-1',
    wallTime: '2026-11-07T10:00:00.000Z',
    sessionId: 'sess-1',
    type: 'session_start',
    appVersion: '1.0.0',
  };

  const sampleEvent2: LearnerEvent = {
    v: 1,
    id: 'evt-2',
    wallTime: '2026-11-07T10:05:00.000Z',
    sessionId: 'sess-1',
    type: 'session_end',
  };

  describe('MemoryStorage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
      storage = new MemoryStorage();
    });

    it('appends and retrieves events', async () => {
      expect(await storage.getEvents()).toEqual([]);
      await storage.appendEvent(sampleEvent);
      await storage.appendEvent(sampleEvent2);
      const events = await storage.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('evt-1');
      expect(events[1].id).toBe('evt-2');
    });

    it('replaces events', async () => {
      await storage.appendEvent(sampleEvent);
      await storage.replaceEvents([sampleEvent2]);
      const events = await storage.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-2');
    });

    it('manages meta store', async () => {
      expect(await storage.getMeta('key1')).toBeNull();
      await storage.setMeta('key1', { foo: 'bar' });
      expect(await storage.getMeta<{ foo: string }>('key1')).toEqual({ foo: 'bar' });
      await storage.deleteMeta('key1');
      expect(await storage.getMeta('key1')).toBeNull();
    });

    it('clears all events and meta', async () => {
      await storage.appendEvent(sampleEvent);
      await storage.setMeta('key1', 123);
      await storage.clearAll();
      expect(await storage.getEvents()).toEqual([]);
      expect(await storage.getMeta('key1')).toBeNull();
    });

    it('deep-clones events so mutations do not leak into storage', async () => {
      const complexEvent: LearnerEvent = {
        v: 1,
        id: 'c-1',
        wallTime: '2026-11-07T10:00:00.000Z',
        sessionId: 's-1',
        type: 'prediction',
        predictionId: 'p1',
        question: 'Q',
        answer: 'A',
        expected: 'A',
        competency: 'mech.auto-peep',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        hidden: false,
        contextTags: ['copd'],
      };

      await storage.appendEvent(complexEvent);
      // Mutate original contextTags
      complexEvent.contextTags!.push('mutated');

      const retrieved = await storage.getEvents();
      expect(retrieved[0].contextTags).toEqual(['copd']);

      // Mutate retrieved contextTags
      retrieved[0].contextTags!.push('mutated-again');
      const retrieved2 = await storage.getEvents();
      expect(retrieved2[0].contextTags).toEqual(['copd']);
    });
  });

  describe('IndexedDbStorage', () => {
    let storage: IndexedDbStorage;

    beforeEach(async () => {
      storage = new IndexedDbStorage('test-idb-storage');
      await storage.clearAll();
    });

    it('appends and retrieves events in IndexedDB', async () => {
      expect(await storage.getEvents()).toEqual([]);
      await storage.appendEvent(sampleEvent);
      await storage.appendEvent(sampleEvent2);
      const events = await storage.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('evt-1');
      expect(events[1].id).toBe('evt-2');
    });

    it('replaces events in IndexedDB atomically', async () => {
      await storage.appendEvent(sampleEvent);
      await storage.replaceEvents([sampleEvent2]);
      const events = await storage.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-2');
    });

    it('manages meta in IndexedDB', async () => {
      expect(await storage.getMeta('testKey')).toBeNull();
      await storage.setMeta('testKey', { alpha: 42 });
      expect(await storage.getMeta<{ alpha: number }>('testKey')).toEqual({ alpha: 42 });
      await storage.deleteMeta('testKey');
      expect(await storage.getMeta('testKey')).toBeNull();
    });

    it('clears all events and meta in IndexedDB', async () => {
      await storage.appendEvent(sampleEvent);
      await storage.setMeta('testKey', 'value');
      await storage.clearAll();
      expect(await storage.getEvents()).toEqual([]);
      expect(await storage.getMeta('testKey')).toBeNull();
    });

    it('persists across two createLearner instances via IndexedDB', async () => {
      const dbName = 'test-idb-persistence';
      const storage1 = new IndexedDbStorage(dbName);
      await storage1.clearAll();

      const learner1 = createLearner(storage1);
      await learner1.record({
        v: 1,
        id: 'pred-1',
        wallTime: '2026-11-07T12:00:00.000Z',
        sessionId: 'sess-persist',
        runId: 'run-p',
        type: 'prediction',
        predictionId: 'p1',
        question: 'What is Pplat?',
        answer: '25',
        expected: '25',
        competency: 'mech.driving-pressure',
        evidenceType: 'prediction',
        correct: true,
        guidance: 'independent',
        confidence: 'certain',
        hidden: false,
      });
      await learner1.setGuidanceOverride('mech.driving-pressure', 'prompted');

      // Instance 2 pointing to the same database
      const storage2 = new IndexedDbStorage(dbName);
      const learner2 = createLearner(storage2);

      const states = await learner2.getCompetencyStates();
      const drivingPres = states.find(s => s.competency === 'mech.driving-pressure');
      expect(drivingPres).toBeDefined();
      expect(drivingPres?.status).toBe('practising');
      expect(drivingPres?.evidenceCount).toBe(1);
      expect(drivingPres?.guidanceOverride).toBe('prompted');
      expect(drivingPres?.guidance).toBe('prompted');
    });
  });
});
