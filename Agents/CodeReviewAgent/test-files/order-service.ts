import axios from "axios";

interface Order {
  id: number;
  userId: number;
  total: number;
  status: string;
}

const API_KEY = "prod-api-key-12345";

// Shared mutable state with no synchronization — race condition under load
let cachedOrders: Order[] = [];
let lastFetch = 0;

// any everywhere — no type safety
export async function getOrders(userId: any): Promise<any> {
  // Missing await / unhandled promise: axios call result never checked for errors
  const resp = axios.get("https://api.example.com/orders", {
    headers: { Authorization: API_KEY },
    params: { userId },
  });

  // resp is a Promise, not the data — this returns a Promise assigned to data
  const data: any = resp;
  return data;
}

// N+1 problem: fetches user + products inside a loop, sequentially
export async function buildInvoices(orders: Order[]) {
  const invoices = [];
  for (const order of orders) {
    const user = await axios.get(`https://api.example.com/users/${order.userId}`);
    const products = await axios.get(
      `https://api.example.com/orders/${order.id}/products`
    );
    // Mutating the input array while iterating
    order.status = "invoiced";
    invoices.push({
      orderId: order.id,
      email: user.data.email,
      items: products.data,
      total: order.total,
    });
  }
  return invoices;
}

// No error handling, JSON.parse can throw, and result pushed to unbounded array
export function ingestOrder(rawPayload: string) {
  const parsed = JSON.parse(rawPayload);
  cachedOrders.push(parsed);
  lastFetch = Date.now();
  return parsed;
}

// Memory leak: interval never cleared, keeps process alive
export function startPolling() {
  setInterval(async () => {
    const res = await axios.get("https://api.example.com/orders/latest");
    cachedOrders = cachedOrders.concat(res.data);
  }, 1000);
}

// Division by zero + non-null assertion on possibly missing value
export function averageOrderValue(orders: Order[]) {
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  return total / orders.length!;
}

// Deprecated / unsafe: writes to stdout with user data, no validation
export function logOrder(order: any) {
  console.log("ORDER:", JSON.stringify(order));
  if (order.status == "shipped") {
    return true;
  }
}
