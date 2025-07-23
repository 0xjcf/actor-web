/**
 * @module actor-core/runtime/examples/actor-proxy-example
 * @description Example demonstrating tRPC-inspired actor proxies
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { assign, setup } from 'xstate';
import { type CreateProxyClient, createProxyActor, procedures } from '../actor-proxy.js';
import { Logger } from '../logger.js';

// ========================================================================================
// EXAMPLE: E-COMMERCE SERVICE WITH ACTOR PROXIES
// ========================================================================================

export namespace ECommerceExample {
  // Define types for our e-commerce domain
  export interface Product {
    id: string;
    name: string;
    price: number;
    category: string;
    inStock: boolean;
  }

  export interface Order {
    id: string;
    userId: string;
    products: Array<{ productId: string; quantity: number }>;
    total: number;
    status: 'pending' | 'processing' | 'shipped' | 'delivered';
    createdAt: number;
  }

  export interface User {
    id: string;
    name: string;
    email: string;
    address: string;
  }

  // Define our tRPC-inspired router
  export const ecommerceRouter = {
    // Product operations
    products: {
      list: procedures.query<
        { category?: string; search?: string },
        { products: Product[]; total: number }
      >(),
      get: procedures.query<{ id: string }, Product | null>(),
      create: procedures.mutation<Omit<Product, 'id'>, { product: Product; success: boolean }>(),
      update: procedures.mutation<
        { id: string; updates: Partial<Product> },
        { product: Product; success: boolean }
      >(),
      delete: procedures.mutation<{ id: string }, { success: boolean }>(),
    },

    // Order operations
    orders: {
      create: procedures.mutation<
        { userId: string; products: Array<{ productId: string; quantity: number }> },
        { order: Order; success: boolean }
      >(),
      get: procedures.query<{ id: string }, Order | null>(),
      list: procedures.query<{ userId?: string }, { orders: Order[]; total: number }>(),
      updateStatus: procedures.mutation<
        { id: string; status: Order['status'] },
        { order: Order; success: boolean }
      >(),

      // Real-time order tracking
      track: procedures.subscription<
        { orderId: string },
        { orderId: string; status: Order['status']; timestamp: number }
      >(),
    },

    // User operations
    users: {
      register: procedures.mutation<
        { name: string; email: string; address: string },
        { user: User; success: boolean }
      >(),
      get: procedures.query<{ id: string }, User | null>(),
      update: procedures.mutation<
        { id: string; updates: Partial<User> },
        { user: User; success: boolean }
      >(),
    },

    // Analytics and reporting
    analytics: {
      sales: procedures.query<
        { startDate: number; endDate: number },
        {
          totalSales: number;
          orderCount: number;
          topProducts: Array<{ product: Product; sales: number }>;
        }
      >(),
      inventory: procedures.query<
        { lowStockOnly?: boolean },
        { products: Array<{ product: Product; stockLevel: number }> }
      >(),

      // Real-time sales updates
      salesUpdates: procedures.subscription<
        { interval: 'minute' | 'hour' | 'day' },
        { sales: number; orders: number; timestamp: number }
      >(),
    },
  } as const;

  // Type inference for our client
  export type ECommerceClient = CreateProxyClient<typeof ecommerceRouter>;

  // Create the state machine that handles our e-commerce operations
  export const ecommerceMachine = setup({
    types: {
      context: {} as {
        products: Map<string, Product>;
        orders: Map<string, Order>;
        users: Map<string, User>;
        subscribers: Map<string, Set<string>>;
        pendingResponses: Array<{
          type: 'response';
          correlationId: string;
          result: unknown;
          timestamp: number;
        }>;
      },
      events: {} as
        | { type: 'PROXY_QUERY'; procedure: string; input: unknown; correlationId: string }
        | { type: 'PROXY_MUTATION'; procedure: string; input: unknown; correlationId: string }
        | { type: 'PROXY_SUBSCRIPTION'; procedure: string; input: unknown }
        | { type: 'PROXY_UNSUBSCRIBE'; procedure: string }
        | { type: 'SEED_DATA' },
    },
    actions: {
      seedData: assign({
        products: () => {
          const products = new Map<string, Product>();

          // Add some sample products
          products.set('laptop-1', {
            id: 'laptop-1',
            name: 'MacBook Pro 16"',
            price: 2499.99,
            category: 'electronics',
            inStock: true,
          });

          products.set('book-1', {
            id: 'book-1',
            name: 'The Actor Model Book',
            price: 29.99,
            category: 'books',
            inStock: true,
          });

          products.set('coffee-1', {
            id: 'coffee-1',
            name: 'Premium Coffee Beans',
            price: 19.99,
            category: 'food',
            inStock: false,
          });

          return products;
        },
        users: () => {
          const users = new Map<string, User>();

          users.set('user-1', {
            id: 'user-1',
            name: 'John Doe',
            email: 'john@example.com',
            address: '123 Main St, City, State 12345',
          });

          return users;
        },
      }),

      handleProxyQuery: assign({
        pendingResponses: ({ context, event }) => {
          const { procedure, input, correlationId } = event as any;
          let result: unknown = null;

          switch (procedure) {
            case 'products.list': {
              const { category, search } = input as { category?: string; search?: string };
              let filteredProducts = Array.from(context.products.values());

              if (category) {
                filteredProducts = filteredProducts.filter((p) => p.category === category);
              }

              if (search) {
                filteredProducts = filteredProducts.filter((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase())
                );
              }

              result = { products: filteredProducts, total: filteredProducts.length };
              break;
            }

            case 'products.get': {
              const { id: productId } = input as { id: string };
              result = context.products.get(productId) || null;
              break;
            }

            case 'orders.get': {
              const { id: orderId } = input as { id: string };
              result = context.orders.get(orderId) || null;
              break;
            }

            case 'orders.list': {
              const { userId } = input as { userId?: string };
              let orders = Array.from(context.orders.values());

              if (userId) {
                orders = orders.filter((o) => o.userId === userId);
              }

              result = { orders, total: orders.length };
              break;
            }

            case 'users.get': {
              const { id: userId2 } = input as { id: string };
              result = context.users.get(userId2) || null;
              break;
            }

            case 'analytics.sales': {
              const { startDate, endDate } = input as { startDate: number; endDate: number };
              const salesOrders = Array.from(context.orders.values()).filter(
                (o) => o.createdAt >= startDate && o.createdAt <= endDate
              );

              const totalSales = salesOrders.reduce((sum, o) => sum + o.total, 0);
              const orderCount = salesOrders.length;

              // Calculate top products
              const productSales = new Map<string, number>();
              salesOrders.forEach((order) => {
                order.products.forEach((item) => {
                  const current = productSales.get(item.productId) || 0;
                  productSales.set(item.productId, current + item.quantity);
                });
              });

              const topProducts = Array.from(productSales.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([productId, sales]) => ({
                  product: context.products.get(productId)!,
                  sales,
                }))
                .filter((item) => item.product);

              result = { totalSales, orderCount, topProducts };
              break;
            }

            case 'analytics.inventory': {
              const { lowStockOnly } = input as { lowStockOnly?: boolean };
              const products = Array.from(context.products.values());

              const inventory = products.map((product) => ({
                product,
                stockLevel: product.inStock ? 100 : 0, // Simplified stock level
              }));

              result = {
                products: lowStockOnly ? inventory.filter((i) => i.stockLevel < 10) : inventory,
              };
              break;
            }

            default:
              result = null;
          }

          return [
            ...context.pendingResponses,
            {
              type: 'response' as const,
              correlationId,
              result,
              timestamp: Date.now(),
            },
          ];
        },
      }),

      handleProxyMutation: assign({
        products: ({ context, event }) => {
          const { procedure, input } = event as any;
          const newProducts = new Map(context.products);

          switch (procedure) {
            case 'products.create': {
              const productData = input as Omit<Product, 'id'>;
              const newProductId = `product-${Date.now()}`;
              newProducts.set(newProductId, { ...productData, id: newProductId });
              break;
            }

            case 'products.update': {
              const { id, updates } = input as { id: string; updates: Partial<Product> };
              const existingProduct = newProducts.get(id);
              if (existingProduct) {
                newProducts.set(id, { ...existingProduct, ...updates });
              }
              break;
            }

            case 'products.delete': {
              const { id: deleteId } = input as { id: string };
              newProducts.delete(deleteId);
              break;
            }
          }

          return newProducts;
        },

        orders: ({ context, event }) => {
          const { procedure, input } = event as any;
          const newOrders = new Map(context.orders);

          switch (procedure) {
            case 'orders.create': {
              const { userId, products } = input as {
                userId: string;
                products: Array<{ productId: string; quantity: number }>;
              };

              const total = products.reduce((sum, item) => {
                const product = context.products.get(item.productId);
                return sum + (product ? product.price * item.quantity : 0);
              }, 0);

              const newOrderId = `order-${Date.now()}`;
              newOrders.set(newOrderId, {
                id: newOrderId,
                userId,
                products,
                total,
                status: 'pending',
                createdAt: Date.now(),
              });
              break;
            }

            case 'orders.updateStatus': {
              const { id, status } = input as { id: string; status: Order['status'] };
              const existingOrder = newOrders.get(id);
              if (existingOrder) {
                newOrders.set(id, { ...existingOrder, status });
              }
              break;
            }
          }

          return newOrders;
        },

        users: ({ context, event }) => {
          const { procedure, input } = event as any;
          const newUsers = new Map(context.users);

          switch (procedure) {
            case 'users.register': {
              const userData = input as { name: string; email: string; address: string };
              const newUserId = `user-${Date.now()}`;
              newUsers.set(newUserId, { ...userData, id: newUserId });
              break;
            }

            case 'users.update': {
              const { id, updates } = input as { id: string; updates: Partial<User> };
              const existingUser = newUsers.get(id);
              if (existingUser) {
                newUsers.set(id, { ...existingUser, ...updates });
              }
              break;
            }
          }

          return newUsers;
        },

        pendingResponses: ({ context, event }) => {
          const { procedure, input, correlationId } = event as any;
          let result: unknown = null;

          switch (procedure) {
            case 'products.create': {
              const productData = input as Omit<Product, 'id'>;
              const newProductId = `product-${Date.now()}`;
              result = {
                product: { ...productData, id: newProductId },
                success: true,
              };
              break;
            }

            case 'products.update': {
              const { id, updates } = input as { id: string; updates: Partial<Product> };
              const existingProduct = context.products.get(id);
              if (existingProduct) {
                result = {
                  product: { ...existingProduct, ...updates },
                  success: true,
                };
              } else {
                result = { product: null, success: false };
              }
              break;
            }

            case 'products.delete':
              result = { success: true };
              break;

            case 'orders.create': {
              const { userId, products } = input as {
                userId: string;
                products: Array<{ productId: string; quantity: number }>;
              };

              const total = products.reduce((sum, item) => {
                const product = context.products.get(item.productId);
                return sum + (product ? product.price * item.quantity : 0);
              }, 0);

              const newOrderId = `order-${Date.now()}`;
              result = {
                order: {
                  id: newOrderId,
                  userId,
                  products,
                  total,
                  status: 'pending' as const,
                  createdAt: Date.now(),
                },
                success: true,
              };
              break;
            }

            case 'orders.updateStatus': {
              const { id: orderId, status } = input as { id: string; status: Order['status'] };
              const existingOrder = context.orders.get(orderId);
              if (existingOrder) {
                result = {
                  order: { ...existingOrder, status },
                  success: true,
                };
              } else {
                result = { order: null, success: false };
              }
              break;
            }

            case 'users.register': {
              const userData = input as { name: string; email: string; address: string };
              const newUserId = `user-${Date.now()}`;
              result = {
                user: { ...userData, id: newUserId },
                success: true,
              };
              break;
            }

            case 'users.update': {
              const { id: userId2, updates: userUpdates } = input as {
                id: string;
                updates: Partial<User>;
              };
              const existingUser = context.users.get(userId2);
              if (existingUser) {
                result = {
                  user: { ...existingUser, ...userUpdates },
                  success: true,
                };
              } else {
                result = { user: null, success: false };
              }
              break;
            }

            default:
              result = { success: false };
          }

          return [
            ...context.pendingResponses,
            {
              type: 'response' as const,
              correlationId,
              result,
              timestamp: Date.now(),
            },
          ];
        },
      }),

      handleProxySubscription: assign({
        subscribers: ({ context, event }) => {
          const { procedure, input } = event as any;
          const newSubscribers = new Map(context.subscribers);
          const key = `${procedure}:${JSON.stringify(input)}`;

          if (!newSubscribers.has(key)) {
            newSubscribers.set(key, new Set());
          }

          return newSubscribers;
        },
      }),
    },
  }).createMachine({
    id: 'ecommerce-service',
    initial: 'initializing',
    context: {
      products: new Map(),
      orders: new Map(),
      users: new Map(),
      subscribers: new Map(),
      pendingResponses: [],
    },
    states: {
      initializing: {
        entry: ['seedData'],
        always: 'active',
      },
      active: {
        on: {
          PROXY_QUERY: {
            actions: ['handleProxyQuery'],
          },
          PROXY_MUTATION: {
            actions: ['handleProxyMutation'],
          },
          PROXY_SUBSCRIPTION: {
            actions: ['handleProxySubscription'],
          },
        },
      },
    },
  });

  /**
   * Demonstrate the e-commerce service with actor proxies
   */
  export async function demonstrateECommerceService() {
    const log = Logger.namespace('ECOMMERCE_EXAMPLE');

    log.info('🛍️ Starting E-Commerce Service Demo');

    // Create actor and proxy using the factory function
    const { actor: ecommerceActor, proxy: ecommerce } = createProxyActor(
      ecommerceMachine,
      ecommerceRouter
    );

    // Start the actor
    ecommerceActor.start();

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // === PRODUCT MANAGEMENT ===
      log.info('📦 Product Management Demo');

      // List all products
      const allProducts = await ecommerce.products.list({});
      log.info('Initial products:', { count: allProducts.total });

      // Search for electronics
      const electronics = await ecommerce.products.list({ category: 'electronics' });
      log.info('Electronics found:', { count: electronics.total });

      // Get specific product
      const laptop = await ecommerce.products.get({ id: 'laptop-1' });
      log.info('Laptop details:', { name: laptop?.name, price: laptop?.price });

      // Create new product
      const newProduct = await ecommerce.products.create({
        name: 'Wireless Headphones',
        price: 199.99,
        category: 'electronics',
        inStock: true,
      });
      log.info('Created product:', { id: newProduct.product.id, name: newProduct.product.name });

      // Update product
      const updatedProduct = await ecommerce.products.update({
        id: newProduct.product.id,
        updates: { price: 149.99 },
      });
      log.info('Updated product price:', { newPrice: updatedProduct.product.price });

      // === USER MANAGEMENT ===
      log.info('👥 User Management Demo');

      // Register new user
      const newUser = await ecommerce.users.register({
        name: 'Jane Smith',
        email: 'jane@example.com',
        address: '456 Oak Ave, City, State 54321',
      });
      log.info('Registered user:', { id: newUser.user.id, email: newUser.user.email });

      // Update user
      const updatedUser = await ecommerce.users.update({
        id: newUser.user.id,
        updates: { address: '789 Pine St, City, State 98765' },
      });
      log.info('Updated user address:', { newAddress: updatedUser.user.address });

      // === ORDER MANAGEMENT ===
      log.info('🛒 Order Management Demo');

      // Create order
      const newOrder = await ecommerce.orders.create({
        userId: newUser.user.id,
        products: [
          { productId: 'laptop-1', quantity: 1 },
          { productId: newProduct.product.id, quantity: 2 },
        ],
      });
      log.info('Created order:', {
        id: newOrder.order.id,
        total: newOrder.order.total,
        status: newOrder.order.status,
      });

      // Update order status
      const updatedOrder = await ecommerce.orders.updateStatus({
        id: newOrder.order.id,
        status: 'processing',
      });
      log.info('Updated order status:', { status: updatedOrder.order.status });

      // List user's orders
      const userOrders = await ecommerce.orders.list({ userId: newUser.user.id });
      log.info('User orders:', { count: userOrders.total });

      // === ANALYTICS ===
      log.info('📊 Analytics Demo');

      // Get sales analytics
      const salesAnalytics = await ecommerce.analytics.sales({
        startDate: Date.now() - 86400000, // 24 hours ago
        endDate: Date.now(),
      });
      log.info('Sales analytics:', {
        totalSales: salesAnalytics.totalSales,
        orderCount: salesAnalytics.orderCount,
        topProductsCount: salesAnalytics.topProducts.length,
      });

      // Get inventory report
      const inventory = await ecommerce.analytics.inventory({});
      log.info('Inventory report:', { productsTracked: inventory.products.length });

      // === SUBSCRIPTIONS ===
      log.info('🔔 Subscription Demo');

      // Create order tracking subscription
      const orderTracking = ecommerce.orders.track({ orderId: newOrder.order.id });
      const trackingSubscription = orderTracking.subscribe((update) => {
        log.info('Order tracking update:', {
          orderId: update.orderId,
          status: update.status,
          timestamp: new Date(update.timestamp).toISOString(),
        });
      });

      // Create sales analytics subscription
      const salesUpdates = ecommerce.analytics.salesUpdates({ interval: 'hour' });
      const salesSubscription = salesUpdates.subscribe((update) => {
        log.info('Sales update:', {
          sales: update.sales,
          orders: update.orders,
          timestamp: new Date(update.timestamp).toISOString(),
        });
      });

      // Simulate some activity
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Clean up subscriptions
      trackingSubscription.unsubscribe();
      salesSubscription.unsubscribe();

      log.info('✅ E-Commerce Service Demo completed successfully');
    } catch (error) {
      log.error('❌ E-Commerce Service Demo failed:', error);
      throw error;
    } finally {
      // Clean up
      await ecommerceActor.stop();
    }
  }
}

// ========================================================================================
// EXAMPLE: AI ASSISTANT WITH ACTOR PROXIES
// ========================================================================================

export namespace AIAssistantExample {
  // Define our AI assistant router
  export const aiAssistantRouter = {
    // Core AI operations
    chat: {
      send: procedures.mutation<
        { message: string; context?: string },
        { response: string; confidence: number; tokens: number }
      >(),

      // Streaming chat responses
      stream: procedures.subscription<
        { message: string; context?: string },
        { chunk: string; done: boolean; tokens: number }
      >(),
    },

    // Knowledge management
    knowledge: {
      search: procedures.query<
        { query: string; limit?: number },
        { results: Array<{ content: string; score: number; source: string }> }
      >(),

      add: procedures.mutation<
        { content: string; source: string; metadata?: Record<string, unknown> },
        { id: string; success: boolean }
      >(),

      update: procedures.mutation<
        { id: string; updates: { content?: string; metadata?: Record<string, unknown> } },
        { success: boolean }
      >(),
    },

    // Tool execution
    tools: {
      execute: procedures.mutation<
        { tool: string; parameters: Record<string, unknown> },
        { result: unknown; success: boolean; executionTime: number }
      >(),

      list: procedures.query<
        { category?: string },
        { tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }
      >(),
    },

    // Memory and context
    memory: {
      store: procedures.mutation<
        { key: string; value: unknown; ttl?: number },
        { success: boolean }
      >(),

      retrieve: procedures.query<{ key: string }, { value: unknown | null; exists: boolean }>(),

      clear: procedures.mutation<{ pattern?: string }, { cleared: number; success: boolean }>(),
    },

    // Analytics and monitoring
    analytics: {
      usage: procedures.query<
        { timeframe: 'hour' | 'day' | 'week' },
        { requests: number; tokens: number; errors: number; avgResponseTime: number }
      >(),

      performance: procedures.subscription<
        { interval: number },
        { cpu: number; memory: number; activeRequests: number; timestamp: number }
      >(),
    },
  } as const;

  // Type inference for our AI assistant client
  export type AIAssistantClient = CreateProxyClient<typeof aiAssistantRouter>;

  /**
   * Demonstrate the AI assistant with actor proxies
   */
  export async function demonstrateAIAssistant() {
    const log = Logger.namespace('AI_ASSISTANT_EXAMPLE');

    log.info('🤖 Starting AI Assistant Demo');

    // Create a simple AI assistant machine
    const aiAssistantMachine = setup({
      types: {
        context: {} as {
          knowledge: Map<
            string,
            { content: string; source: string; metadata?: Record<string, unknown> }
          >;
          memory: Map<string, { value: unknown; ttl?: number; created: number }>;
          tools: Map<
            string,
            { name: string; description: string; parameters: Record<string, unknown> }
          >;
          analytics: { requests: number; tokens: number; errors: number; responseTime: number[] };
          pendingResponses: Array<{
            type: 'response';
            correlationId: string;
            result: unknown;
            timestamp: number;
          }>;
        },
        events: {} as
          | { type: 'PROXY_QUERY'; procedure: string; input: unknown; correlationId: string }
          | { type: 'PROXY_MUTATION'; procedure: string; input: unknown; correlationId: string }
          | { type: 'PROXY_SUBSCRIPTION'; procedure: string; input: unknown },
      },
      actions: {
        // Initialize with some sample data
        initializeAI: assign({
          knowledge: () => {
            const knowledge = new Map();
            knowledge.set('ai-1', {
              content:
                'Artificial Intelligence is the simulation of human intelligence in machines.',
              source: 'Encyclopedia',
              metadata: { category: 'technology', importance: 'high' },
            });
            return knowledge;
          },

          tools: () => {
            const tools = new Map();
            tools.set('calculator', {
              name: 'calculator',
              description: 'Performs basic mathematical calculations',
              parameters: { expression: 'string' },
            });
            tools.set('weather', {
              name: 'weather',
              description: 'Gets current weather information',
              parameters: { location: 'string' },
            });
            return tools;
          },

          analytics: () => ({
            requests: 0,
            tokens: 0,
            errors: 0,
            responseTime: [],
          }),
        }),

        handleProxyQuery: assign({
          pendingResponses: ({ context, event }) => {
            const { procedure, input, correlationId } = event as any;
            let result: unknown = null;

            switch (procedure) {
              case 'knowledge.search': {
                const { query, limit = 10 } = input as { query: string; limit?: number };
                const searchResults = Array.from(context.knowledge.values())
                  .filter((item) => item.content.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, limit)
                  .map((item) => ({
                    content: item.content,
                    score: Math.random() * 0.5 + 0.5,
                    source: item.source,
                  }));
                result = { results: searchResults };
                break;
              }

              case 'tools.list': {
                const { category } = input as { category?: string };
                const tools = Array.from(context.tools.values());
                result = { tools };
                break;
              }

              case 'memory.retrieve': {
                const { key } = input as { key: string };
                const memoryItem = context.memory.get(key);
                if (memoryItem) {
                  const isExpired =
                    memoryItem.ttl && Date.now() - memoryItem.created > memoryItem.ttl;
                  result = {
                    value: isExpired ? null : memoryItem.value,
                    exists: !isExpired,
                  };
                } else {
                  result = { value: null, exists: false };
                }
                break;
              }

              case 'analytics.usage': {
                const { timeframe } = input as { timeframe: 'hour' | 'day' | 'week' };
                const avgResponseTime =
                  context.analytics.responseTime.length > 0
                    ? context.analytics.responseTime.reduce((a, b) => a + b, 0) /
                      context.analytics.responseTime.length
                    : 0;
                result = {
                  requests: context.analytics.requests,
                  tokens: context.analytics.tokens,
                  errors: context.analytics.errors,
                  avgResponseTime,
                };
                break;
              }

              default:
                result = null;
            }

            return [
              ...context.pendingResponses,
              {
                type: 'response' as const,
                correlationId,
                result,
                timestamp: Date.now(),
              },
            ];
          },
        }),

        handleProxyMutation: assign({
          knowledge: ({ context, event }) => {
            const { procedure, input } = event as any;
            const newKnowledge = new Map(context.knowledge);

            if (procedure === 'knowledge.add') {
              const { content, source, metadata } = input as {
                content: string;
                source: string;
                metadata?: Record<string, unknown>;
              };
              const id = `knowledge-${Date.now()}`;
              newKnowledge.set(id, { content, source, metadata });
            } else if (procedure === 'knowledge.update') {
              const { id, updates } = input as {
                id: string;
                updates: { content?: string; metadata?: Record<string, unknown> };
              };
              const existing = newKnowledge.get(id);
              if (existing) {
                newKnowledge.set(id, { ...existing, ...updates });
              }
            }

            return newKnowledge;
          },

          memory: ({ context, event }) => {
            const { procedure, input } = event as any;
            const newMemory = new Map(context.memory);

            if (procedure === 'memory.store') {
              const { key, value, ttl } = input as { key: string; value: unknown; ttl?: number };
              newMemory.set(key, { value, ttl, created: Date.now() });
            } else if (procedure === 'memory.clear') {
              const { pattern } = input as { pattern?: string };
              if (pattern) {
                for (const [key] of Array.from(newMemory)) {
                  if (key.includes(pattern)) {
                    newMemory.delete(key);
                  }
                }
              } else {
                newMemory.clear();
              }
            }

            return newMemory;
          },

          analytics: ({ context, event }) => {
            const { procedure } = event as any;
            const newAnalytics = { ...context.analytics };

            // Track this request
            newAnalytics.requests++;
            newAnalytics.responseTime.push(Math.random() * 500 + 100); // Simulate response time

            // Keep only last 100 response times
            if (newAnalytics.responseTime.length > 100) {
              newAnalytics.responseTime = newAnalytics.responseTime.slice(-100);
            }

            return newAnalytics;
          },

          pendingResponses: ({ context, event }) => {
            const { procedure, input, correlationId } = event as any;
            let result: unknown = null;

            switch (procedure) {
              case 'chat.send': {
                const { message, context: chatContext } = input as {
                  message: string;
                  context?: string;
                };
                const tokens = message.split(' ').length * 1.3; // Rough token estimate
                result = {
                  response: `I understand you're asking about: ${message}. This is a simulated response.`,
                  confidence: Math.random() * 0.4 + 0.6,
                  tokens: Math.floor(tokens),
                };
                break;
              }

              case 'knowledge.add': {
                const { content } = input as { content: string };
                const id = `knowledge-${Date.now()}`;
                result = { id, success: true };
                break;
              }

              case 'knowledge.update':
                result = { success: true };
                break;

              case 'tools.execute': {
                const { tool, parameters } = input as {
                  tool: string;
                  parameters: Record<string, unknown>;
                };
                const startTime = Date.now();

                let toolResult: unknown = null;
                if (tool === 'calculator') {
                  toolResult = `Result: ${Math.random() * 100}`;
                } else if (tool === 'weather') {
                  toolResult = {
                    temperature: 22,
                    condition: 'sunny',
                    location: parameters.location,
                  };
                }

                result = {
                  result: toolResult,
                  success: true,
                  executionTime: Date.now() - startTime,
                };
                break;
              }

              case 'memory.store':
                result = { success: true };
                break;

              case 'memory.clear': {
                const { pattern } = input as { pattern?: string };
                let cleared = 0;
                if (pattern) {
                  for (const [key] of Array.from(context.memory)) {
                    if (key.includes(pattern)) {
                      cleared++;
                    }
                  }
                } else {
                  cleared = context.memory.size;
                }
                result = { cleared, success: true };
                break;
              }

              default:
                result = { success: false };
            }

            return [
              ...context.pendingResponses,
              {
                type: 'response' as const,
                correlationId,
                result,
                timestamp: Date.now(),
              },
            ];
          },
        }),
      },
    }).createMachine({
      id: 'ai-assistant',
      initial: 'initializing',
      context: {
        knowledge: new Map(),
        memory: new Map(),
        tools: new Map(),
        analytics: { requests: 0, tokens: 0, errors: 0, responseTime: [] },
        pendingResponses: [],
      },
      states: {
        initializing: {
          entry: ['initializeAI'],
          always: 'active',
        },
        active: {
          on: {
            PROXY_QUERY: {
              actions: ['handleProxyQuery'],
            },
            PROXY_MUTATION: {
              actions: ['handleProxyMutation'],
            },
          },
        },
      },
    });

    // Create the AI assistant with proxy
    const { actor: aiActor, proxy: ai } = createProxyActor(aiAssistantMachine, aiAssistantRouter);

    // Start the actor
    aiActor.start();

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // === CHAT INTERACTION ===
      log.info('💬 Chat Demo');

      const chatResponse = await ai.chat.send({
        message: 'What is artificial intelligence?',
        context: 'educational',
      });
      log.info('AI Response:', {
        response: `${chatResponse.response.substring(0, 50)}...`,
        confidence: chatResponse.confidence,
        tokens: chatResponse.tokens,
      });

      // === KNOWLEDGE MANAGEMENT ===
      log.info('📚 Knowledge Management Demo');

      // Add knowledge
      const addResult = await ai.knowledge.add({
        content:
          'Machine learning is a subset of AI that enables computers to learn without being explicitly programmed.',
        source: 'AI Textbook',
        metadata: { category: 'technology', difficulty: 'intermediate' },
      });
      log.info('Added knowledge:', { id: addResult.id, success: addResult.success });

      // Search knowledge
      const searchResults = await ai.knowledge.search({
        query: 'artificial intelligence',
        limit: 5,
      });
      log.info('Knowledge search results:', { count: searchResults.results.length });

      // === TOOL EXECUTION ===
      log.info('🛠️ Tool Execution Demo');

      // List available tools
      const toolsList = await ai.tools.list({});
      log.info('Available tools:', { count: toolsList.tools.length });

      // Execute calculator tool
      const calcResult = await ai.tools.execute({
        tool: 'calculator',
        parameters: { expression: '2 + 2' },
      });
      log.info('Calculator result:', {
        result: calcResult.result,
        executionTime: calcResult.executionTime,
      });

      // Execute weather tool
      const weatherResult = await ai.tools.execute({
        tool: 'weather',
        parameters: { location: 'New York' },
      });
      log.info('Weather result:', { result: weatherResult.result });

      // === MEMORY MANAGEMENT ===
      log.info('🧠 Memory Management Demo');

      // Store memory
      const storeResult = await ai.memory.store({
        key: 'user_preference',
        value: { theme: 'dark', language: 'en' },
        ttl: 3600000, // 1 hour
      });
      log.info('Stored memory:', { success: storeResult.success });

      // Retrieve memory
      const retrieveResult = await ai.memory.retrieve({ key: 'user_preference' });
      log.info('Retrieved memory:', {
        exists: retrieveResult.exists,
        value: retrieveResult.value,
      });

      // === ANALYTICS ===
      log.info('📊 Analytics Demo');

      const usageStats = await ai.analytics.usage({ timeframe: 'hour' });
      log.info('Usage analytics:', {
        requests: usageStats.requests,
        tokens: usageStats.tokens,
        avgResponseTime: usageStats.avgResponseTime,
      });

      // === SUBSCRIPTIONS ===
      log.info('🔔 Subscription Demo');

      // Create performance monitoring subscription
      const performanceMonitoring = ai.analytics.performance({ interval: 1000 });
      const perfSubscription = performanceMonitoring.subscribe((stats) => {
        log.info('Performance stats:', {
          cpu: stats.cpu,
          memory: stats.memory,
          activeRequests: stats.activeRequests,
        });
      });

      // Simulate some activity
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clean up subscription
      perfSubscription.unsubscribe();

      log.info('✅ AI Assistant Demo completed successfully');
    } catch (error) {
      log.error('❌ AI Assistant Demo failed:', error);
      throw error;
    } finally {
      // Clean up
      await aiActor.stop();
    }
  }
}

// ========================================================================================
// EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all actor proxy examples
 */
export async function runActorProxyExamples() {
  const log = Logger.namespace('ACTOR_PROXY_EXAMPLES');

  try {
    log.info('🚀 Starting Actor Proxy Examples');

    log.info('🛍️ Running E-Commerce Service Example...');
    await ECommerceExample.demonstrateECommerceService();

    log.info('🤖 Running AI Assistant Example...');
    await AIAssistantExample.demonstrateAIAssistant();

    log.info('✅ All actor proxy examples completed successfully');
  } catch (error) {
    log.error('❌ Actor proxy examples failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runActorProxyExamples as default };

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runActorProxyExamples().catch(console.error);
}
