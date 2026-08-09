import { Router, type Request, type Response } from 'express';
import {
  getChannels, addChannel,
  getWarehouses, addWarehouse,
  getPlatforms, connectPlatform, disconnectPlatform, SUPPORTED_PLATFORMS,
  getProducts, addProduct, syncProductToPlatform,
  getShippingRoutes, addShippingRoute, getShipments, createShipment,
  getRegulations, checkProductCompliance,
  getEcommerceStats,
} from '../services/ecommerceService.js';
import { toolRegistry } from '../services/toolRegistry.js';

const router = Router();

// ===== 仪表盘 =====

router.get('/stats', (req: Request, res: Response) => {
  res.json({ success: true, stats: getEcommerceStats() });
});

// ===== 渠道管理 =====

router.get('/channels', (req: Request, res: Response) => {
  res.json({ success: true, channels: getChannels() });
});

router.post('/channels', (req: Request, res: Response) => {
  const { name, type, country, contact, email, phone, minOrderQuantity, leadTimeDays, paymentTerms } = req.body;
  if (!name || !type || !country) {
    res.status(400).json({ success: false, error: 'name, type, country required' });
    return;
  }
  const channel = addChannel({
    name, type, country, contact: contact || '', email: email || '', phone: phone || '',
    minOrderQuantity: minOrderQuantity || 1, leadTimeDays: leadTimeDays || 7,
    paymentTerms: paymentTerms || 'T/T 30% advance', status: 'active',
  });
  res.json({ success: true, channel });
});

// ===== 仓库管理 =====

router.get('/warehouses', (req: Request, res: Response) => {
  res.json({ success: true, warehouses: getWarehouses() });
});

router.post('/warehouses', (req: Request, res: Response) => {
  const { name, type, country, city, address, capacity, contact, phone } = req.body;
  if (!name || !type || !country || !city) {
    res.status(400).json({ success: false, error: 'name, type, country, city required' });
    return;
  }
  const wh = addWarehouse({
    name, type, country, city, address: address || '', capacity: capacity || 1000,
    usedCapacity: 0, contact: contact || '', phone: phone || '', status: 'active',
  });
  res.json({ success: true, warehouse: wh });
});

// ===== 平台管理 =====

router.get('/platforms', (req: Request, res: Response) => {
  res.json({ success: true, platforms: getPlatforms(), supported: SUPPORTED_PLATFORMS });
});

router.post('/platforms', (req: Request, res: Response) => {
  const { platform, storeName, apiKey, apiSecret, region, currency } = req.body;
  if (!platform || !storeName) {
    res.status(400).json({ success: false, error: 'platform, storeName required' });
    return;
  }
  const account = connectPlatform({ platform, storeName, apiKey: apiKey || '', apiSecret: apiSecret || '', region: region || 'global', currency: currency || 'USD' });
  res.json({ success: true, account });
});

router.delete('/platforms/:id', (req: Request, res: Response) => {
  const ok = disconnectPlatform(req.params.id);
  res.json({ success: ok });
});

// ===== 商品管理 =====

router.get('/products', (req: Request, res: Response) => {
  res.json({ success: true, products: getProducts() });
});

router.post('/products', (req: Request, res: Response) => {
  const { sku, title, description, category, price, costPrice, currency, weight, dimensions, hsCode, inventory } = req.body;
  if (!sku || !title) {
    res.status(400).json({ success: false, error: 'sku, title required' });
    return;
  }
  const product = addProduct({
    sku, title, titleTranslations: {}, description: description || '', descriptionTranslations: {},
    category: category || 'general', price: price || 0, costPrice: costPrice || 0,
    currency: currency || 'USD', weight: weight || 0,
    dimensions: dimensions || { length: 0, width: 0, height: 0 },
    images: [], hsCode: hsCode || '0000', platforms: [],
    inventory: inventory || 0, status: 'draft',
  });
  res.json({ success: true, product });
});

router.post('/products/:id/sync', (req: Request, res: Response) => {
  const { platform } = req.body;
  if (!platform) {
    res.status(400).json({ success: false, error: 'platform required' });
    return;
  }
  const result = syncProductToPlatform(req.params.id, platform);
  res.json(result);
});

router.post('/products/:id/compliance', (req: Request, res: Response) => {
  const { countryCode } = req.body;
  const product = getProducts().find(p => p.id === req.params.id);
  if (!product) { res.status(404).json({ success: false, error: '商品不存在' }); return; }
  const result = checkProductCompliance(product, countryCode);
  res.json({ success: true, ...result });
});

// ===== 物流管理 =====

router.get('/shipping/routes', (req: Request, res: Response) => {
  res.json({ success: true, routes: getShippingRoutes() });
});

router.post('/shipping/routes', (req: Request, res: Response) => {
  const { name, type, origin, destination, carrier, estimatedDays, costPerKg, minWeight, trackingSupported } = req.body;
  if (!name || !type || !origin || !destination) {
    res.status(400).json({ success: false, error: 'name, type, origin, destination required' });
    return;
  }
  const route = addShippingRoute({
    name, type, origin, destination, carrier: carrier || '',
    estimatedDays: estimatedDays || { min: 3, max: 7 }, costPerKg: costPerKg || 0,
    minWeight: minWeight || 0.5, trackingSupported: trackingSupported !== false, status: 'active',
  });
  res.json({ success: true, route });
});

router.get('/shipping/shipments', (req: Request, res: Response) => {
  res.json({ success: true, shipments: getShipments() });
});

router.post('/shipping/shipments', (req: Request, res: Response) => {
  const { routeId, orderId, origin, destination, weight, cost, currency, estimatedDelivery } = req.body;
  if (!routeId || !orderId) {
    res.status(400).json({ success: false, error: 'routeId, orderId required' });
    return;
  }
  const shipment = createShipment({
    routeId, orderId, origin: origin || '', destination: destination || '',
    weight: weight || 0, cost: cost || 0, currency: currency || 'USD',
    estimatedDelivery: estimatedDelivery || new Date().toISOString(), status: 'pending',
  });
  res.json({ success: true, shipment });
});

// ===== 法规管理 =====

router.get('/regulations', (req: Request, res: Response) => {
  const countryCode = req.query.country as string;
  res.json({ success: true, regulations: getRegulations(countryCode) });
});

router.post('/regulations/check', (req: Request, res: Response) => {
  const { productId, countryCode } = req.body;
  const product = getProducts().find(p => p.id === productId);
  if (!product) { res.status(404).json({ success: false, error: '商品不存在' }); return; }
  const result = checkProductCompliance(product, countryCode);
  res.json({ success: true, ...result });
});

export default router;
