/**
 * @module actor-core/runtime/examples/event-emission-example
 * @description Example demonstrating actor event emission functionality
 *
 * This example shows how actors can emit typed events during message
 * processing and how other actors or systems can subscribe to these events.
 *
 * @author Agent A (Tech Lead) - 2025-07-18
 */

import type { ActorBehavior, ActorMessage, ActorPID } from '../actor-system.js';
import { createActorSystem } from '../actor-system-impl.js';
import { enableDevModeForCLI, Logger } from '../logger.js';

// Enable logging for this example
enableDevModeForCLI();

const log = Logger.namespace('EVENT_EMISSION_EXAMPLE');

// Define message payload types for type safety
interface CreateOrderPayload {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number }>;
}

interface OrderActionPayload {
  orderId: string;
}

interface UpdateStockPayload {
  productId: string;
  quantity: number;
}

interface ReserveStockPayload {
  items: Array<{ productId: string; quantity: number }>;
}

// Type guards for payload validation
function _isCreateOrderPayload(payload: unknown): payload is CreateOrderPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'orderId' in payload &&
    'customerId' in payload &&
    'items' in payload &&
    typeof (payload as CreateOrderPayload).orderId === 'string' &&
    typeof (payload as CreateOrderPayload).customerId === 'string' &&
    Array.isArray((payload as CreateOrderPayload).items)
  );
}

function _isOrderActionPayload(payload: unknown): payload is OrderActionPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'orderId' in payload &&
    typeof (payload as OrderActionPayload).orderId === 'string'
  );
}

function _isUpdateStockPayload(payload: unknown): payload is UpdateStockPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'productId' in payload &&
    'quantity' in payload &&
    typeof (payload as UpdateStockPayload).productId === 'string' &&
    typeof (payload as UpdateStockPayload).quantity === 'number'
  );
}

function _isReserveStockPayload(payload: unknown): payload is ReserveStockPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'items' in payload &&
    Array.isArray((payload as ReserveStockPayload).items)
  );
}

// Define our event types
interface OrderEvent {
  type: 'ORDER_CREATED' | 'ORDER_SHIPPED' | 'ORDER_DELIVERED' | 'ORDER_CANCELLED';
  orderId: string;
  customerId: string;
  timestamp: number;
  details?: unknown;
}

interface InventoryEvent {
  type: 'STOCK_UPDATED' | 'LOW_STOCK_ALERT';
  productId: string;
  quantity: number;
  threshold?: number;
}

// Order Actor State
interface OrderState {
  orders: Map<
    string,
    {
      id: string;
      customerId: string;
      items: Array<{ productId: string; quantity: number }>;
      status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
    }
  >;
}

// Inventory Actor State
interface InventoryState {
  stock: Map<string, number>;
  lowStockThreshold: number;
}

// Create Order Actor behavior
const createOrderActor = (): ActorBehavior<ActorMessage, OrderState, OrderEvent> => ({
  context: { orders: new Map() },

  onMessage: async ({ message, context }) => {
    switch (message.type) {
      case 'CREATE_ORDER': {
        if (!_isCreateOrderPayload(message.payload)) {
          log.warn('Invalid CREATE_ORDER payload', { payload: message.payload });
          return { context };
        }

        const { orderId, customerId, items } = message.payload;
        const newOrder = {
          id: orderId,
          customerId,
          items,
          status: 'pending' as const,
        };

        context.orders.set(orderId, newOrder);

        return {
          context,
          emit: [
            {
              type: 'ORDER_CREATED',
              orderId,
              customerId,
              timestamp: Date.now(),
              details: { items },
            },
          ],
        };
      }

      case 'SHIP_ORDER': {
        if (!_isOrderActionPayload(message.payload)) {
          log.warn('Invalid SHIP_ORDER payload', { payload: message.payload });
          return { context };
        }

        const { orderId } = message.payload;
        const order = context.orders.get(orderId);

        if (order && order.status === 'pending') {
          order.status = 'shipped';

          return {
            context,
            emit: [
              {
                type: 'ORDER_SHIPPED',
                orderId,
                customerId: order.customerId,
                timestamp: Date.now(),
              },
            ],
          };
        }

        return { context };
      }

      case 'DELIVER_ORDER': {
        if (!_isOrderActionPayload(message.payload)) {
          log.warn('Invalid DELIVER_ORDER payload', { payload: message.payload });
          return { context };
        }

        const { orderId } = message.payload;
        const order = context.orders.get(orderId);

        if (order && order.status === 'shipped') {
          order.status = 'delivered';

          return {
            context,
            emit: [
              {
                type: 'ORDER_DELIVERED',
                orderId,
                customerId: order.customerId,
                timestamp: Date.now(),
              },
            ],
          };
        }

        return { context };
      }

      default:
        return { context };
    }
  },
});

// Create Inventory Actor behavior
const createInventoryActor = (): ActorBehavior<ActorMessage, InventoryState, InventoryEvent> => ({
  context: {
    stock: new Map([
      ['PRODUCT-001', 100],
      ['PRODUCT-002', 50],
      ['PRODUCT-003', 25],
    ]),
    lowStockThreshold: 20,
  },

  onMessage: async ({ message, context }) => {
    switch (message.type) {
      case 'UPDATE_STOCK': {
        if (!_isUpdateStockPayload(message.payload)) {
          log.warn('Invalid UPDATE_STOCK payload', { payload: message.payload });
          return { context };
        }

        const { productId, quantity } = message.payload;
        const currentStock = context.stock.get(productId) || 0;
        const newStock = currentStock + quantity;

        context.stock.set(productId, newStock);

        const events: InventoryEvent[] = [
          {
            type: 'STOCK_UPDATED',
            productId,
            quantity: newStock,
          },
        ];

        // Check for low stock
        if (newStock < context.lowStockThreshold && newStock > 0) {
          events.push({
            type: 'LOW_STOCK_ALERT',
            productId,
            quantity: newStock,
            threshold: context.lowStockThreshold,
          });
        }

        return { context, emit: events };
      }

      case 'RESERVE_STOCK': {
        if (!_isReserveStockPayload(message.payload)) {
          log.warn('Invalid RESERVE_STOCK payload', { payload: message.payload });
          return { context };
        }

        const { items } = message.payload;
        const events: InventoryEvent[] = [];

        // Reserve stock for each item
        for (const item of items) {
          const currentStock = context.stock.get(item.productId) || 0;
          const newStock = currentStock - item.quantity;

          if (newStock >= 0) {
            context.stock.set(item.productId, newStock);

            events.push({
              type: 'STOCK_UPDATED',
              productId: item.productId,
              quantity: newStock,
            });

            // Check for low stock
            if (newStock < context.lowStockThreshold && newStock > 0) {
              events.push({
                type: 'LOW_STOCK_ALERT',
                productId: item.productId,
                quantity: newStock,
                threshold: context.lowStockThreshold,
              });
            }
          }
        }

        return { context, emit: events };
      }

      default:
        return { context };
    }
  },
});

// Create Notification Actor that subscribes to events
const createNotificationActor = (
  orderActor: ActorPID,
  inventoryActor: ActorPID
): ActorBehavior => ({
  context: {},

  onStart: async (state) => {
    console.log('🔔 Notification Service Starting - Setting up subscriptions...');

    // Subscribe to order events
    const _orderSub = orderActor.subscribe('EMIT:*', (event) => {
      console.log('🔔📦 Notification received - Order Event:', event.type, event.payload);
    });

    // Subscribe to low stock alerts
    const _stockSub = inventoryActor.subscribe('EMIT:LOW_STOCK_ALERT', (event) => {
      console.log('🔔⚠️  Notification received - Low Stock Alert:', event.payload);
    });

    console.log('🔔 Notification Service Ready - Subscriptions active');

    return state;
  },

  onMessage: async ({ context }) => ({ context }),
});

// Main example
async function runExample() {
  log.info('Starting Event Emission Example');

  // Create actor system
  const system = createActorSystem({
    nodeAddress: 'event-example-node',
  });

  await system.start();

  try {
    // Spawn actors
    const orderActor = await system.spawn(createOrderActor(), { id: 'order-service' });
    const inventoryActor = await system.spawn(createInventoryActor(), { id: 'inventory-service' });
    // Spawn notification actor to subscribe to events
    const notificationActor = await system.spawn(
      createNotificationActor(orderActor, inventoryActor),
      { id: 'notification-service' }
    );

    // Send init message to trigger onStart
    await notificationActor.send({
      type: 'INIT',
      payload: null,
      timestamp: Date.now(),
      version: '1.0.0',
    });

    // Give notification actor time to set up subscriptions
    await new Promise((resolve) => setTimeout(resolve, 50));

    console.log('\n📋 Starting Order Processing...\n');

    // Also subscribe directly to see all events
    const orderEvents: ActorMessage[] = [];
    const orderSub = orderActor.subscribe('EMIT:*', (event) => {
      orderEvents.push(event);
      console.log('📦 Direct Order Event:', event.type, event.payload);
    });

    // Subscribe to all inventory events for monitoring
    const inventoryMonitor = inventoryActor.subscribe('EMIT:*', (event) => {
      console.log('📊 Inventory Event:', event.type, '→', event.payload);
    });

    // Create an order
    console.log('1️⃣ Creating order...');
    await orderActor.send({
      type: 'CREATE_ORDER',
      payload: {
        orderId: 'ORDER-001',
        customerId: 'CUSTOMER-123',
        items: [
          { productId: 'PRODUCT-001', quantity: 5 },
          { productId: 'PRODUCT-003', quantity: 15 },
        ],
      },
      timestamp: Date.now(),
      version: '1.0.0',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reserve inventory for the order
    console.log('2️⃣ Reserving inventory...');
    await inventoryActor.send({
      type: 'RESERVE_STOCK',
      payload: {
        items: [
          { productId: 'PRODUCT-001', quantity: 5 },
          { productId: 'PRODUCT-003', quantity: 15 },
        ],
      },
      timestamp: Date.now(),
      version: '1.0.0',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Ship the order
    console.log('3️⃣ Shipping order...');
    await orderActor.send({
      type: 'SHIP_ORDER',
      payload: { orderId: 'ORDER-001' },
      timestamp: Date.now(),
      version: '1.0.0',
    });

    // Give time for events to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Deliver the order
    console.log('4️⃣ Delivering order...');
    await orderActor.send({
      type: 'DELIVER_ORDER',
      payload: { orderId: 'ORDER-001' },
      timestamp: Date.now(),
      version: '1.0.0',
    });

    // Give time for final events
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Cleanup
    inventoryMonitor();
    orderSub();

    console.log('\n📊 Summary:');
    console.log(`- Order events received: ${orderEvents.length}`);
    console.log(
      '- Events:',
      orderEvents.map((e) => e.type)
    );

    log.info('Example completed successfully');
  } finally {
    await system.stop();
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((error) => {
    log.error('Example failed:', error);
    process.exit(1);
  });
}

export { runExample };
