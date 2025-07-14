/**
 * Behavior Tests for Screen Reader Announcements - Actor-SPA Framework
 *
 * Focus: Testing how screen reader announcements behave from a user perspective
 * Tests the screen reader announcement system directly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  createTestEnvironment,
  setupGlobalMocks,
  type TestEnvironment,
} from '../testing/actor-test-utils';
import { Logger } from './dev-mode.js';
import {
  createScreenReaderAnnouncementHelper,
  type ScreenReaderAnnouncementActor,
  type ScreenReaderAnnouncementHelper,
  screenReaderAnnouncementMachine,
} from './screen-reader-announcements.js';

const log = Logger.namespace('SCREEN_READER_ANNOUNCEMENTS_TEST');

describe('Screen Reader Announcements', () => {
  let testEnv: TestEnvironment;
  let actor: ScreenReaderAnnouncementActor;
  let helper: ScreenReaderAnnouncementHelper;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
    vi.useFakeTimers();
    log.debug('Test environment initialized with fake timers for screen reader announcements');

    // Create and start the announcement actor
    actor = createActor(screenReaderAnnouncementMachine);
    actor.start();
    actor.send({ type: 'INITIALIZE' });
    log.debug('ScreenReader announcement actor created and initialized');

    // Create helper with updated snapshot after initialization
    const updatedSnapshot = actor.getSnapshot();
    helper = createScreenReaderAnnouncementHelper(actor, updatedSnapshot);
    log.debug('ScreenReader announcement helper created', {
      state: updatedSnapshot.value,
      hasContext: !!updatedSnapshot.context,
    });
  });

  afterEach(() => {
    actor.send({ type: 'CLEANUP' });
    actor.stop();
    testEnv.cleanup();
    vi.useRealTimers();
    log.debug('Test environment cleaned up and real timers restored');
  });

  describe('Basic Announcement Behavior', () => {
    it('announces status messages to screen readers', () => {
      // Behavior: The system can announce status updates to screen readers
      log.debug('Testing status announcement: "Saving your changes..."');
      helper.announceStatus('Saving your changes...');

      let snapshot = actor.getSnapshot();
      log.debug('Status announcement state after initial announcement', {
        state: snapshot.value,
        message: snapshot.context.currentMessage?.message,
        priority: snapshot.context.currentMessage?.priority,
        category: snapshot.context.currentMessage?.category,
      });

      // When announced, it immediately goes to processing
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Saving your changes...');
      expect(snapshot.context.currentMessage?.priority).toBe('polite');
      expect(snapshot.context.currentMessage?.category).toBe('status');

      // Process the announcement
      vi.advanceTimersByTime(600);
      log.debug('Advanced timers by 600ms for announcement processing');

      // Announce completion
      log.debug('Testing success announcement: "Changes saved successfully"');
      helper.announceSuccess('Changes saved successfully');

      snapshot = actor.getSnapshot();
      log.debug('Success announcement state', {
        state: snapshot.value,
        message: snapshot.context.currentMessage?.message,
        category: snapshot.context.currentMessage?.category,
      });

      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Changes saved successfully');
      expect(snapshot.context.currentMessage?.category).toBe('success');
    });

    it('announces form validation errors assertively', () => {
      // Behavior: Form errors need immediate attention from screen reader users
      log.debug('Testing error announcement with assertive priority');
      helper.announceError('Please enter a valid email address');

      const snapshot = actor.getSnapshot();
      log.debug('Error announcement state', {
        state: snapshot.value,
        message: snapshot.context.currentMessage?.message,
        priority: snapshot.context.currentMessage?.priority,
        category: snapshot.context.currentMessage?.category,
        interrupt: snapshot.context.currentMessage?.interrupt,
      });

      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Please enter a valid email address');
      expect(snapshot.context.currentMessage?.priority).toBe('assertive');
      expect(snapshot.context.currentMessage?.category).toBe('error');
      expect(snapshot.context.currentMessage?.interrupt).toBe(true);
    });

    it('announces loading states for async operations', () => {
      // Behavior: Users should know when content is loading
      log.debug('Testing loading announcement for async operation');
      helper.announceLoading('user data');

      let snapshot = actor.getSnapshot();
      log.debug('Loading announcement state', {
        state: snapshot.value,
        message: snapshot.context.currentMessage?.message,
        category: snapshot.context.currentMessage?.category,
      });

      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Loading user data...');
      expect(snapshot.context.currentMessage?.category).toBe('loading');

      // Simulate loading completion
      vi.advanceTimersByTime(3000);
      log.debug('Advanced timers by 3000ms to simulate loading completion');
      helper.announceSuccess('User data loaded successfully');

      snapshot = actor.getSnapshot();
      const history = snapshot.context.announcementHistory;
      log.debug('Loading completion state', {
        state: snapshot.value,
        historyLength: history.length,
        hasLoadingInHistory: history.some((a) => a.category === 'loading'),
      });

      expect(history.some((a) => a.category === 'loading')).toBe(true);
    });

    it('announces navigation changes in single-page apps', () => {
      // Behavior: Route changes should be announced
      log.debug('Testing navigation announcement for single-page app');
      helper.announceNavigation('Home page');

      let snapshot = actor.getSnapshot();
      log.debug('Navigation announcement state', {
        state: snapshot.value,
        message: snapshot.context.currentMessage?.message,
        category: snapshot.context.currentMessage?.category,
      });

      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Navigated to Home page');
      expect(snapshot.context.currentMessage?.category).toBe('navigation');

      // Process and navigate to another page
      vi.advanceTimersByTime(600);
      log.debug('Advanced timers and announcing second navigation');
      helper.announceNavigation('About page');

      // Check history includes both navigations
      vi.advanceTimersByTime(600);
      snapshot = actor.getSnapshot();
      const navHistory = snapshot.context.announcementHistory.filter(
        (a) => a.category === 'navigation'
      );
      log.debug('Navigation history after multiple announcements', {
        totalHistoryLength: snapshot.context.announcementHistory.length,
        navHistoryLength: navHistory.length,
        navigationMessages: navHistory.map((h) => h.message),
      });

      expect(navHistory.length).toBe(2);
      expect(navHistory[0].message).toBe('Navigated to Home page');
      expect(navHistory[1].message).toBe('Navigated to About page');
    });

    it('manages announcement queue for rapid updates', () => {
      // Behavior: Multiple rapid announcements should be queued
      log.debug('Testing rapid announcement queuing with 3 messages');
      helper.announce('First notification');
      helper.announce('Second notification');
      helper.announce('Third notification');

      let snapshot = actor.getSnapshot();
      log.debug('Queue state after rapid announcements', {
        state: snapshot.value,
        currentMessage: snapshot.context.currentMessage?.message,
        queueLength: snapshot.context.messageQueue.length,
        queuedMessages: snapshot.context.messageQueue.map((m) => m.message),
      });

      // In processing state, one message is being processed
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('First notification');
      expect(snapshot.context.messageQueue.length).toBe(2);
      expect(snapshot.context.messageQueue[0].message).toBe('Second notification');
      expect(snapshot.context.messageQueue[1].message).toBe('Third notification');

      // Process first announcement (500ms delay in processing state)
      vi.advanceTimersByTime(500);
      log.debug('Advanced timers by 500ms to process first announcement');
      snapshot = actor.getSnapshot();
      log.debug('State after processing first announcement', {
        state: snapshot.value,
        historyLength: snapshot.context.announcementHistory.length,
        lastProcessedMessage: snapshot.context.announcementHistory[0]?.message,
        remainingQueueLength: snapshot.context.messageQueue.length,
      });

      // Should be back to idle with history updated
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.announcementHistory.length).toBe(1);
      expect(snapshot.context.announcementHistory[0].message).toBe('First notification');

      // Queue should still have 2 messages
      expect(snapshot.context.messageQueue.length).toBe(2);

      // The state machine doesn't auto-process, so we need to announce again or manually process
      // Let's clear the queue and verify the history
      helper.clearQueue();

      snapshot = actor.getSnapshot();
      expect(snapshot.context.messageQueue.length).toBe(0);
      expect(snapshot.context.announcementHistory.length).toBe(1); // Only first was processed
    });
  });

  describe('Priority and Queue Management', () => {
    it('prioritizes error announcements over status messages', () => {
      // Behavior: Errors should interrupt and take priority
      log.debug('Testing priority: error announcements interrupting status messages');
      helper.announceStatus('Processing...');
      helper.announceError('Critical error occurred!');

      const snapshot = actor.getSnapshot();
      log.debug('Priority test state after error announcement', {
        state: snapshot.value,
        currentMessage: snapshot.context.currentMessage?.message,
        currentPriority: snapshot.context.currentMessage?.priority,
        currentCategory: snapshot.context.currentMessage?.category,
      });

      // Error should take priority and interrupt
      expect(snapshot.context.currentMessage?.message).toBe('Critical error occurred!');
      expect(snapshot.context.currentMessage?.priority).toBe('assertive');
      expect(snapshot.context.currentMessage?.interrupt).toBe(true);
    });

    it('handles announcements being disabled and re-enabled', () => {
      // Behavior: System should allow disabling announcements
      log.debug('Testing announcement disable/enable functionality');
      helper.disableAnnouncements();
      let snapshot = actor.getSnapshot();
      log.debug('State after disabling announcements', {
        isEnabled: snapshot.context.isEnabled,
      });
      expect(snapshot.context.isEnabled).toBe(false);

      // Try to announce while disabled
      helper.announce('This should not be queued');
      snapshot = actor.getSnapshot();
      log.debug('Attempted announcement while disabled', {
        queueLength: snapshot.context.messageQueue.length,
      });
      expect(snapshot.context.messageQueue.length).toBe(0);

      // Re-enable
      log.debug('Re-enabling announcements');
      helper.enableAnnouncements();
      snapshot = actor.getSnapshot();
      log.debug('State after re-enabling announcements', {
        isEnabled: snapshot.context.isEnabled,
      });
      expect(snapshot.context.isEnabled).toBe(true);

      helper.announce('This should be queued');
      snapshot = actor.getSnapshot();
      log.debug('State after announcement when re-enabled', {
        state: snapshot.value,
        currentMessage: snapshot.context.currentMessage?.message,
      });
      expect(snapshot.value).toBe('processing');
    });

    it('handles duplicate suppression', () => {
      // Default: suppress duplicates
      log.debug('Testing duplicate suppression (default behavior)');
      helper.announce('Duplicate message');
      vi.advanceTimersByTime(600); // Process it

      // Try to announce same message
      helper.announce('Duplicate message');
      let snapshot = actor.getSnapshot();
      log.debug('Duplicate suppression test', {
        queueLength: snapshot.context.messageQueue.length,
      });
      expect(snapshot.context.messageQueue.length).toBe(0); // Suppressed

      // Disable suppression
      log.debug('Disabling duplicate suppression and testing duplicates');
      helper.setSuppressDuplicates(false);
      helper.announce('Duplicate message');
      helper.announce('Duplicate message');

      // Wait for processing to start
      vi.advanceTimersByTime(100);
      snapshot = actor.getSnapshot();
      log.debug('State with duplicate suppression disabled', {
        currentMessage: snapshot.context.currentMessage?.message,
        queueLength: snapshot.context.messageQueue.length,
      });

      // One is being processed, one is queued
      expect(snapshot.context.currentMessage?.message).toBe('Duplicate message');
      expect(snapshot.context.messageQueue.length).toBe(1);
    });
  });

  describe('Real-world Patterns', () => {
    it('handles shopping cart updates with announcements', () => {
      // Behavior: E-commerce cart updates should be announced
      log.debug('Testing shopping cart announcement pattern');
      helper.announceAction('Add to cart', 'Laptop added to cart');
      vi.advanceTimersByTime(600);

      helper.announceAction('Add to cart', 'Mouse added to cart');
      vi.advanceTimersByTime(600);

      helper.announceAction('Remove from cart', 'Laptop removed from cart');
      vi.advanceTimersByTime(600);

      const snapshot = actor.getSnapshot();
      const actionAnnouncements = snapshot.context.announcementHistory.filter(
        (a) => a.category === 'action'
      );
      log.debug('Shopping cart announcement results', {
        totalHistory: snapshot.context.announcementHistory.length,
        actionAnnouncementsCount: actionAnnouncements.length,
        actionMessages: actionAnnouncements.map((a) => a.message),
      });

      expect(actionAnnouncements.length).toBe(3);
      expect(actionAnnouncements[0].message).toContain('Laptop added');
      expect(actionAnnouncements[1].message).toContain('Mouse added');
      expect(actionAnnouncements[2].message).toContain('Laptop removed');
    });

    it('handles form submission flow', () => {
      // Start submission
      log.debug('Testing form submission flow with multiple announcement types');
      helper.announceStatus('Submitting form...');
      vi.advanceTimersByTime(600);

      // Validation error
      helper.announceError('Please fix the following errors: Email is required');
      vi.advanceTimersByTime(600);

      // Retry submission
      helper.announceStatus('Submitting form...');
      vi.advanceTimersByTime(600);

      // Success
      helper.announceSuccess('Form submitted successfully!');
      vi.advanceTimersByTime(600);

      const history = helper.getHistory();
      log.debug('Form submission flow results', {
        totalHistory: history.length,
        hasError: history.some((a) => a.category === 'error'),
        hasSuccess: history.some((a) => a.category === 'success'),
        categories: history.map((h) => h.category),
      });

      expect(history.some((a) => a.category === 'error')).toBe(true);
      expect(history.some((a) => a.category === 'success')).toBe(true);
    });

    it('provides helper methods for templates', () => {
      // Queue some announcements
      log.debug('Testing template helper methods with announcement queue');
      helper.announce('Message 1');
      helper.announce('Message 2');
      helper.announce('Message 3');

      // One is being processed, two are queued
      let snapshot = actor.getSnapshot();
      log.debug('Template helper test state', {
        queueLength: snapshot.context.messageQueue.length,
        state: snapshot.value,
      });
      expect(snapshot.context.messageQueue.length).toBe(2);
      expect(snapshot.value).toBe('processing');

      // Get status attributes for template
      const statusAttrs = helper.getAnnouncementStatusAttributes();
      log.debug('Template status attributes', { statusAttrs });
      expect(statusAttrs).toContain('data-announcing="true"');
      expect(statusAttrs).toContain('data-announcement-queue="2"');

      // Clear queue
      log.debug('Clearing announcement queue');
      helper.clearQueue();
      snapshot = actor.getSnapshot();
      log.debug('State after clearing queue', {
        queueLength: snapshot.context.messageQueue.length,
      });
      expect(snapshot.context.messageQueue.length).toBe(0);
    });
  });
});
