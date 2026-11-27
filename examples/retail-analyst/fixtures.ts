// Synthetic Product 5 records and weather copied from Udacity Lesson 2, Part II.
export const sales = [
  {
    date: '2024-01-10',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 96,
    revenue: 2587.2,
  },
  {
    date: '2024-01-11',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 114,
    revenue: 3072.3,
  },
  {
    date: '2024-01-12',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 342,
    revenue: 9216.9,
  },
  {
    date: '2024-01-13',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 103,
    revenue: 2775.85,
  },
  {
    date: '2024-01-14',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 104,
    revenue: 2802.8,
  },
  {
    date: '2024-01-15',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 100,
    revenue: 2695.0,
  },
  {
    date: '2024-01-16',
    product_id: 'P005',
    product_name: 'Product 5',
    quantity: 125,
    revenue: 3368.75,
  },
] as const;

export const weather = [
  {
    date: '2024-01-10',
    temperature: {
      fahrenheit: 23.4,
      celsius: -4.8,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: null,
    },
  },
  {
    date: '2024-01-11',
    temperature: {
      fahrenheit: 39.3,
      celsius: 4.1,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: null,
    },
  },
  {
    date: '2024-01-12',
    temperature: {
      fahrenheit: 41.1,
      celsius: 5.1,
    },
    conditions: {
      main: 'Heavy Rain',
      precipitation: 'Heavy Rain',
      precipitation_amount: 2.7,
      special_event: 'Flood Warning',
    },
  },
  {
    date: '2024-01-13',
    temperature: {
      fahrenheit: 27.2,
      celsius: -2.6,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: null,
    },
  },
  {
    date: '2024-01-14',
    temperature: {
      fahrenheit: 22.9,
      celsius: -5.1,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: null,
    },
  },
  {
    date: '2024-01-15',
    temperature: {
      fahrenheit: 33.2,
      celsius: 0.7,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: 'High Winds',
    },
  },
  {
    date: '2024-01-16',
    temperature: {
      fahrenheit: 23.3,
      celsius: -4.8,
    },
    conditions: {
      main: 'Clear',
      precipitation: 'None',
      precipitation_amount: 0,
      special_event: null,
    },
  },
] as const;
