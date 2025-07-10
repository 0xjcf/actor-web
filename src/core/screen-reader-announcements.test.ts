/**
 * Behavior Tests for Screen Reader Announcements - Actor-SPA Framework
 *
 * Focus: Testing how screen reader announcements behave from a user perspective
 * Tests the screen reader announcement system directly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { createTestEnvironment, setupGlobalMocks, type TestEnvironment } from '@/framework/testing';
import {
  createScreenReaderAnnouncementHelper,
  type ScreenReaderAnnouncementActor,
  type ScreenReaderAnnouncementHelper,
  screenReaderAnnouncementMachine,
} from './screen-reader-announcements.js';

describe('Screen Reader Announcements', () => {
  let testEnv: TestEnvironment;
  let actor: ScreenReaderAnnouncementActor;
  let helper: ScreenReaderAnnouncementHelper;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();
    vi.useFakeTimers();

    // Create and start the announcement actor
    actor = createActor(screenReaderAnnouncementMachine);
    actor.start();
    actor.send({ type: 'INITIALIZE' });

    // Create helper with updated snapshot after initialization
    const updatedSnapshot = actor.getSnapshot();
    helper = createScreenReaderAnnouncementHelper(actor, updatedSnapshot);
  });

  afterEach(() => {
    actor.send({ type: 'CLEANUP' });
    actor.stop();
    testEnv.cleanup();
    vi.useRealTimers();
  });

  describe('Basic Announcement Behavior', () => {
    it('announces status messages to screen readers', () => {
      // Behavior: The system can announce status updates to screen readers
      helper.announceStatus('Saving your changes...');

      let snapshot = actor.getSnapshot();
      // When announced, it immediately goes to processing
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Saving your changes...');
      expect(snapshot.context.currentMessage?.priority).toBe('polite');
      expect(snapshot.context.currentMessage?.category).toBe('status');

      // Process the announcement
      vi.advanceTimersByTime(600);

      // Announce completion
      helper.announceSuccess('Changes saved successfully');

      snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Changes saved successfully');
      expect(snapshot.context.currentMessage?.category).toBe('success');
    });

    it('announces form validation errors assertively', () => {
      // Behavior: Form errors need immediate attention from screen reader users
      helper.announceError('Please enter a valid email address');

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Please enter a valid email address');
      expect(snapshot.context.currentMessage?.priority).toBe('assertive');
      expect(snapshot.context.currentMessage?.category).toBe('error');
      expect(snapshot.context.currentMessage?.interrupt).toBe(true);
    });

    it('announces loading states for async operations', () => {
      // Behavior: Users should know when content is loading
      helper.announceLoading('user data');

      let snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Loading user data...');
      expect(snapshot.context.currentMessage?.category).toBe('loading');

      // Simulate loading completion
      vi.advanceTimersByTime(3000);
      helper.announceSuccess('User data loaded successfully');

      snapshot = actor.getSnapshot();
      const history = snapshot.context.announcementHistory;
      expect(history.some((a) => a.category === 'loading')).toBe(true);
      expect(history.some((a) => a.category === 'success')).toBe(true);
    });

    it('announces navigation changes in single-page apps', () => {
      // Behavior: Route changes should be announced
      helper.announceNavigation('Home page');

      let snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('Navigated to Home page');
      expect(snapshot.context.currentMessage?.category).toBe('navigation');

      // Process and navigate to another page
      vi.advanceTimersByTime(600);
      helper.announceNavigation('About page');

      // Check history includes both navigations
      vi.advanceTimersByTime(600);
      snapshot = actor.getSnapshot();
      const navHistory = snapshot.context.announcementHistory.filter(
        (a) => a.category === 'navigation'
      );
      expect(navHistory.length).toBe(2);
      expect(navHistory[0].message).toBe('Navigated to Home page');
      expect(navHistory[1].message).toBe('Navigated to About page');
    });

    it('manages announcement queue for rapid updates', () => {
      // Behavior: Multiple rapid announcements should be queued
      helper.announce('First notification');
      helper.announce('Second notification');
      helper.announce('Third notification');

      let snapshot = actor.getSnapshot();
      // In processing state, one message is being processed
      expect(snapshot.value).toBe('processing');
      expect(snapshot.context.currentMessage?.message).toBe('First notification');
      expect(snapshot.context.messageQueue.length).toBe(2);
      expect(snapshot.context.messageQueue[0].message).toBe('Second notification');
      expect(snapshot.context.messageQueue[1].message).toBe('Third notification');

      // Process first announcement (500ms delay in processing state)
      vi.advanceTimersByTime(500);
      snapshot = actor.getSnapshot();
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

  describe('Announcement Configuration', () => {
    it('uses correct ARIA attributes for different announcement types', () => {
      // Behavior: Different types of announcements need different ARIA configurations
      const liveRegionAttrs = helper.getLiveRegionAttributes();
      expect(liveRegionAttrs).toContain('role="status"');
      expect(liveRegionAttrs).toContain('aria-live="polite"');
      expect(liveRegionAttrs).toContain('aria-atomic="true"');

      // Change politeness level
      helper.setPoliteness('assertive');
      const snapshot = actor.getSnapshot();
      expect(snapshot.context.politenessLevel).toBe('assertive');

      // Test announcement with assertive priority
      helper.announceError('Critical error!');
      const snapshot2 = actor.getSnapshot();
      expect(snapshot2.context.currentMessage?.priority).toBe('assertive');
    });

    it('manages enabled/disabled state', () => {
      // Initially enabled after initialization
      let snapshot = actor.getSnapshot();
      expect(snapshot.context.isEnabled).toBe(true);

      // Disable announcements
      helper.disableAnnouncements();
      snapshot = actor.getSnapshot();
      expect(snapshot.context.isEnabled).toBe(false);

      // Try to announce while disabled
      helper.announce('This should not be queued');
      snapshot = actor.getSnapshot();
      expect(snapshot.context.messageQueue.length).toBe(0);

      // Re-enable
      helper.enableAnnouncements();
      snapshot = actor.getSnapshot();
      expect(snapshot.context.isEnabled).toBe(true);

      helper.announce('This should be queued');
      snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('processing');
    });

    it('handles duplicate suppression', () => {
      // Default: suppress duplicates
      helper.announce('Duplicate message');
      vi.advanceTimersByTime(600); // Process it

      // Try to announce same message
      helper.announce('Duplicate message');
      let snapshot = actor.getSnapshot();
      expect(snapshot.context.messageQueue.length).toBe(0); // Suppressed

      // Disable suppression
      helper.setSuppressDuplicates(false);
      helper.announce('Duplicate message');
      helper.announce('Duplicate message');

      // Wait for processing to start
      vi.advanceTimersByTime(100);
      snapshot = actor.getSnapshot();
      // One is being processed, one is queued
      expect(snapshot.context.currentMessage?.message).toBe('Duplicate message');
      expect(snapshot.context.messageQueue.length).toBe(1);
    });
  });

  describe('Real-world Patterns', () => {
    it('handles shopping cart updates with announcements', () => {
      // Behavior: E-commerce cart updates should be announced
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
      expect(actionAnnouncements.length).toBe(3);
      expect(actionAnnouncements[0].message).toContain('Laptop added');
      expect(actionAnnouncements[1].message).toContain('Mouse added');
      expect(actionAnnouncements[2].message).toContain('Laptop removed');
    });

    it('handles form submission flow', () => {
      // Start submission
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
      expect(history.some((a) => a.category === 'error')).toBe(true);
      expect(history.some((a) => a.category === 'success')).toBe(true);
    });

    it('provides helper methods for templates', () => {
      // Queue some announcements
      helper.announce('Message 1');
      helper.announce('Message 2');
      helper.announce('Message 3');

      // One is being processed, two are queued
      let snapshot = actor.getSnapshot();
      expect(snapshot.context.messageQueue.length).toBe(2);
      expect(snapshot.value).toBe('processing');

      // Get status attributes for template
      const statusAttrs = helper.getAnnouncementStatusAttributes();
      expect(statusAttrs).toContain('data-announcing="true"');
      expect(statusAttrs).toContain('data-announcement-queue="2"');

      // Clear queue
      helper.clearQueue();
      snapshot = actor.getSnapshot();
      expect(snapshot.context.messageQueue.length).toBe(0);
    });
  });
});
