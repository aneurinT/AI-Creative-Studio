/**
 * 跨境电商核心服务
 * 
 * 五大模块：
 * 1. 渠道管理（货物渠道 + 仓库管理）
 * 2. 平台管理（主流跨境平台对接）
 * 3. 商品管理（多平台商品同步）
 * 4. 物流管理（国内外物流渠道）
 * 5. 法规管理（各国货物法律法规）
 */
import { addOperationLog } from './database.js';

// ===== 类型定义 =====

// --- 渠道管理 ---
export interface SupplyChannel {
  id: string;
  name: string;
  type: 'factory' | 'wholesaler' | 'distributor' | 'brand_direct' | 'other';
  country: string;
  contact: string;
  email: string;
  phone: string;
  minOrderQuantity: number;
  leadTimeDays: number;
  paymentTerms: string;
  status: 'active' | 'inactive' | 'pending';
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  type: 'domestic' | 'overseas' | 'fba_prep' | 'bonded';
  country: string;
  city: string;
  address: string;
  capacity: number;         // 容量（立方米）
  usedCapacity: number;     // 已用容量
  contact: string;
  phone: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

// --- 平台管理 ---
export type EcommercePlatform = 'amazon' | 'shopify' | 'shopee' | 'lazada' | 'tiktok_shop' | 'temu' | 'aliexpress' | 'ebay' | 'walmart' | 'mercadolibre';

export interface PlatformAccount {
  id: string;
  platform: EcommercePlatform;
  storeName: string;
  apiKey?: string;
  apiSecret?: string;
  region: string;          // 站点区域
  currency: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string;
  productCount: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

// --- 商品管理 ---
export interface Product {
  id: string;
  sku: string;
  title: string;
  titleTranslations: Record<string, string>;  // 多语言标题
  description: string;
  descriptionTranslations: Record<string, string>;
  category: string;
  price: number;
  costPrice: number;
  currency: string;
  weight: number;           // 克
  dimensions: { length: number; width: number; height: number }; // cm
  images: string[];         // 图片 URL 列表
  aiGeneratedImages?: string[];  // AI 生成的商品图
  hsCode: string;           // 海关编码
  platforms: PlatformProductInfo[];  // 各平台商品信息
  inventory: number;
  status: 'draft' | 'published' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface PlatformProductInfo {
  platform: EcommercePlatform;
  platformProductId?: string;  // 平台上的商品 ID
  platformUrl?: string;
  price: number;               // 平台售价（可不同）
  inventory: number;
  status: 'listed' | 'unlisted' | 'out_of_stock' | 'error';
  lastSync: string;
}

// --- 物流管理 ---
export interface ShippingRoute {
  id: string;
  name: string;
  type: 'express' | 'air_freight' | 'sea_freight' | 'rail' | 'truck';
  origin: { country: string; city: string; warehouseId?: string };
  destination: { country: string; city: string; warehouseId?: string };
  carrier: string;
  estimatedDays: { min: number; max: number };
  costPerKg: number;
  minWeight: number;
  trackingSupported: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Shipment {
  id: string;
  routeId: string;
  orderId: string;
  trackingNumber?: string;
  status: 'pending' | 'picked_up' | 'in_transit' | 'customs_clearance' | 'out_for_delivery' | 'delivered' | 'returned';
  origin: string;
  destination: string;
  weight: number;
  cost: number;
  currency: string;
  estimatedDelivery: string;
  actualDelivery?: string;
  events: ShipmentEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentEvent {
  timestamp: string;
  location: string;
  status: string;
  description: string;
}

// --- 法规管理 ---
export interface CountryRegulation {
  id: string;
  country: string;
  countryCode: string;       // ISO 3166-1 alpha-2
  categories: RegulationCategory[];
  lastUpdated: string;
}

export interface RegulationCategory {
  name: string;               // 如 "电子产品"、"食品"、"化妆品"
  hsCodes: string[];          // 相关海关编码
  restrictions: string[];     // 限制说明
  prohibited: boolean;        // 是否禁止进口
  requiresLicense: boolean;   // 是否需要许可证
  licenseType?: string;       // 许可证类型
  tariffRate: number;         // 关税税率（%）
  vatRate: number;            // 增值税率（%）
  documentation: string[];    // 需要的文件清单
  specialNotes: string[];     // 特殊说明
}

// ===== 内存存储 =====

const supplyChannels: SupplyChannel[] = [];
const warehouses: Warehouse[] = [];
const platformAccounts: PlatformAccount[] = [];
const products: Product[] = [];
const shippingRoutes: ShippingRoute[] = [];
const shipments: Shipment[] = [];
const regulations: CountryRegulation[] = [];

// ===== 初始化示例数据 =====

function initRegulations(): void {
  if (regulations.length > 0) return;
  
  regulations.push(
    {
      id: 'reg-us', country: '美国', countryCode: 'US', lastUpdated: new Date().toISOString(),
      categories: [
        { name: '电子产品', hsCodes: ['8471', '8517', '8525'], restrictions: ['FCC 认证', 'UL 认证'], prohibited: false, requiresLicense: false, tariffRate: 0, vatRate: 0, documentation: ['FCC 声明', '商业发票', '装箱单'], specialNotes: ['部分州需额外环保费'] },
        { name: '纺织品', hsCodes: ['61', '62', '63'], restrictions: ['CPSIA 检测', '阻燃标准'], prohibited: false, requiresLicense: false, tariffRate: 8.5, vatRate: 0, documentation: ['原产地证明', '商业发票', '装箱单'], specialNotes: ['800美元以下免税'] },
        { name: '食品', hsCodes: ['16', '17', '18', '19', '20', '21'], restrictions: ['FDA 注册', '营养标签'], prohibited: false, requiresLicense: true, licenseType: 'FDA', tariffRate: 6.4, vatRate: 0, documentation: ['FDA 注册号', '成分表', '营养标签', '商业发票'], specialNotes: ['需提前向 FDA 备案'] },
      ],
    },
    {
      id: 'reg-eu', country: '欧盟', countryCode: 'EU', lastUpdated: new Date().toISOString(),
      categories: [
        { name: '电子产品', hsCodes: ['8471', '8517', '8525'], restrictions: ['CE 认证', 'RoHS', 'WEEE'], prohibited: false, requiresLicense: true, licenseType: 'CE', tariffRate: 0, vatRate: 20, documentation: ['CE 声明', 'RoHS 报告', '商业发票', '装箱单'], specialNotes: ['需在欧盟注册 EPR（生产者责任延伸）'] },
        { name: '化妆品', hsCodes: ['3303', '3304', '3305', '3306', '3307'], restrictions: ['CPNP 注册', '动物实验禁令'], prohibited: false, requiresLicense: true, licenseType: 'CPNP', tariffRate: 0, vatRate: 20, documentation: ['CPNP 注册号', '成分表', '安全评估报告', '商业发票'], specialNotes: ['必须指定欧盟境内负责人'] },
      ],
    },
    {
      id: 'reg-jp', country: '日本', countryCode: 'JP', lastUpdated: new Date().toISOString(),
      categories: [
        { name: '电子产品', hsCodes: ['8471', '8517'], restrictions: ['PSE 认证', 'VCCI'], prohibited: false, requiresLicense: false, tariffRate: 0, vatRate: 10, documentation: ['PSE 声明', '商业发票', '装箱单'], specialNotes: ['无线产品需 MIC 认证'] },
        { name: '食品', hsCodes: ['16', '17', '18', '19', '20', '21'], restrictions: ['食品卫生法', 'JAS 标准'], prohibited: false, requiresLicense: true, licenseType: 'MHLW', tariffRate: 15, vatRate: 10, documentation: ['进口食品通知书', '成分表', '原产地证明', '商业发票'], specialNotes: ['需日本进口商作为担保'] },
      ],
    },
    {
      id: 'reg-br', country: '巴西', countryCode: 'BR', lastUpdated: new Date().toISOString(),
      categories: [
        { name: '电子产品', hsCodes: ['8471', '8517'], restrictions: ['ANATEL 认证', 'INMETRO'], prohibited: false, requiresLicense: true, licenseType: 'ANATEL', tariffRate: 16, vatRate: 17, documentation: ['ANATEL 证书', '商业发票', '装箱单', '原产地证明'], specialNotes: ['高关税 + 州税(ICMS)，综合税率可达 60%+'] },
      ],
    },
  );
}

initRegulations();

// ===== 渠道管理 =====

export function getChannels(): SupplyChannel[] {
  return supplyChannels.filter(c => c.status === 'active').sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function addChannel(channel: Omit<SupplyChannel, 'id' | 'createdAt' | 'updatedAt'>): SupplyChannel {
  const now = new Date().toISOString();
  const newChannel: SupplyChannel = { ...channel, id: `ch-${Date.now()}`, createdAt: now, updatedAt: now };
  supplyChannels.push(newChannel);
  addOperationLog({ level: 'INFO', category: 'ecommerce', operation: 'add_channel', detail: `新增渠道: ${channel.name}` });
  return newChannel;
}

// ===== 仓库管理 =====

export function getWarehouses(): Warehouse[] {
  return warehouses.filter(w => w.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
}

export function addWarehouse(wh: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>): Warehouse {
  const now = new Date().toISOString();
  const newWh: Warehouse = { ...wh, id: `wh-${Date.now()}`, createdAt: now, updatedAt: now };
  warehouses.push(newWh);
  addOperationLog({ level: 'INFO', category: 'ecommerce', operation: 'add_warehouse', detail: `新增仓库: ${wh.name} (${wh.country})` });
  return newWh;
}

// ===== 平台管理 =====

export const SUPPORTED_PLATFORMS: { id: EcommercePlatform; name: string; region: string; description: string }[] = [
  { id: 'amazon', name: 'Amazon', region: '全球', description: '全球最大电商平台，支持FBA' },
  { id: 'shopify', name: 'Shopify', region: '全球', description: '独立站建站平台，DTC首选' },
  { id: 'shopee', name: 'Shopee', region: '东南亚/拉美', description: '东南亚最大电商平台' },
  { id: 'lazada', name: 'Lazada', region: '东南亚', description: '阿里系东南亚电商平台' },
  { id: 'tiktok_shop', name: 'TikTok Shop', region: '全球', description: '短视频社交电商平台' },
  { id: 'temu', name: 'Temu', region: '全球', description: '拼多多旗下跨境电商平台' },
  { id: 'aliexpress', name: 'AliExpress', region: '全球', description: '阿里巴巴全球零售平台' },
  { id: 'ebay', name: 'eBay', region: '全球', description: '全球C2C/B2C拍卖零售平台' },
  { id: 'walmart', name: 'Walmart', region: '北美', description: '美国最大零售商' },
  { id: 'mercadolibre', name: 'Mercado Libre', region: '拉美', description: '拉丁美洲最大电商平台' },
];

export function getPlatforms(): PlatformAccount[] {
  return platformAccounts;
}

export function connectPlatform(account: Omit<PlatformAccount, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'lastSync' | 'productCount' | 'orderCount'>): PlatformAccount {
  const now = new Date().toISOString();
  const newAccount: PlatformAccount = {
    ...account, id: `plat-${Date.now()}`, status: 'connected', lastSync: now,
    productCount: 0, orderCount: 0, createdAt: now, updatedAt: now,
  };
  platformAccounts.push(newAccount);
  addOperationLog({ level: 'INFO', category: 'ecommerce', operation: 'connect_platform', detail: `接入平台: ${account.platform} (${account.storeName})` });
  return newAccount;
}

export function disconnectPlatform(id: string): boolean {
  const idx = platformAccounts.findIndex(p => p.id === id);
  if (idx === -1) return false;
  platformAccounts[idx].status = 'disconnected';
  platformAccounts[idx].updatedAt = new Date().toISOString();
  return true;
}

// ===== 商品管理 =====

export function getProducts(): Product[] {
  return products.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function addProduct(product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
  const now = new Date().toISOString();
  const newProduct: Product = { ...product, id: `prod-${Date.now()}`, createdAt: now, updatedAt: now };
  products.push(newProduct);
  addOperationLog({ level: 'INFO', category: 'ecommerce', operation: 'add_product', detail: `新增商品: ${product.title} (${product.sku})` });
  return newProduct;
}

export function syncProductToPlatform(productId: string, platform: EcommercePlatform): { success: boolean; platformProductId?: string; error?: string } {
  const product = products.find(p => p.id === productId);
  if (!product) return { success: false, error: '商品不存在' };

  const existing = product.platforms.find(p => p.platform === platform);
  if (existing) {
    existing.lastSync = new Date().toISOString();
    existing.status = 'listed';
    product.updatedAt = new Date().toISOString();
    return { success: true, platformProductId: existing.platformProductId || `mock-${platform}-${product.sku}` };
  }

  const platformInfo: PlatformProductInfo = {
    platform,
    platformProductId: `mock-${platform}-${product.sku}-${Date.now()}`,
    platformUrl: `https://${platform}.com/product/${product.sku}`,
    price: product.price,
    inventory: product.inventory,
    status: 'listed',
    lastSync: new Date().toISOString(),
  };
  product.platforms.push(platformInfo);
  product.updatedAt = new Date().toISOString();

  addOperationLog({ level: 'INFO', category: 'ecommerce', operation: 'sync_product', detail: `商品同步: ${product.title} → ${platform}` });
  return { success: true, platformProductId: platformInfo.platformProductId! };
}

// ===== 物流管理 =====

export function getShippingRoutes(): ShippingRoute[] {
  return shippingRoutes.filter(r => r.status === 'active');
}

export function addShippingRoute(route: Omit<ShippingRoute, 'id' | 'createdAt' | 'updatedAt'>): ShippingRoute {
  const now = new Date().toISOString();
  const newRoute: ShippingRoute = { ...route, id: `route-${Date.now()}`, createdAt: now, updatedAt: now };
  shippingRoutes.push(newRoute);
  return newRoute;
}

export function getShipments(): Shipment[] {
  return shipments.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function createShipment(data: Omit<Shipment, 'id' | 'createdAt' | 'updatedAt' | 'events' | 'trackingNumber'>): Shipment {
  const now = new Date().toISOString();
  const newShipment: Shipment = {
    ...data, id: `ship-${Date.now()}`, trackingNumber: `TRK${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    events: [{ timestamp: now, location: data.origin, status: 'pending', description: '订单已创建，等待揽收' }],
    createdAt: now, updatedAt: now,
  };
  shipments.push(newShipment);
  return newShipment;
}

// ===== 法规管理 =====

export function getRegulations(countryCode?: string): CountryRegulation[] {
  if (countryCode) return regulations.filter(r => r.countryCode === countryCode.toUpperCase());
  return regulations;
}

export function checkProductCompliance(product: Product, countryCode: string): {
  compliant: boolean;
  restrictions: string[];
  requiredDocs: string[];
  estimatedTariff: number;
  estimatedVat: number;
} {
  const reg = regulations.find(r => r.countryCode === countryCode.toUpperCase());
  if (!reg) return { compliant: true, restrictions: [], requiredDocs: [], estimatedTariff: 0, estimatedVat: 0 };

  const category = reg.categories.find(c => c.hsCodes.some(h => product.hsCode.startsWith(h)));
  if (!category) return { compliant: true, restrictions: ['未匹配到具体品类，请人工审核'], requiredDocs: ['商业发票', '装箱单'], estimatedTariff: 10, estimatedVat: 10 };

  return {
    compliant: !category.prohibited,
    restrictions: category.restrictions,
    requiredDocs: category.documentation,
    estimatedTariff: category.tariffRate,
    estimatedVat: category.vatRate,
  };
}

// ===== 统计 =====

export function getEcommerceStats() {
  return {
    totalProducts: products.length,
    totalPlatforms: platformAccounts.filter(p => p.status === 'connected').length,
    totalChannels: supplyChannels.filter(c => c.status === 'active').length,
    totalWarehouses: warehouses.filter(w => w.status === 'active').length,
    activeShipments: shipments.filter(s => s.status !== 'delivered' && s.status !== 'returned').length,
    supportedCountries: regulations.length,
    productsByStatus: {
      draft: products.filter(p => p.status === 'draft').length,
      published: products.filter(p => p.status === 'published').length,
      suspended: products.filter(p => p.status === 'suspended').length,
    },
  };
}
