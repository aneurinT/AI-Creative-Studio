import { useState, useEffect } from 'react';
import {
  Package, Store, Truck, Globe, Shield, BarChart3,
  Plus, Trash2, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, Search, Filter, Download, Upload, ExternalLink,
  Factory, Warehouse as WarehouseIcon, ShoppingCart, Ship,
} from 'lucide-react';
import Navbar from '@/components/Navbar';

// ===== 类型定义 =====
interface EcommerceStats {
  totalProducts: number;
  totalPlatforms: number;
  totalChannels: number;
  totalWarehouses: number;
  activeShipments: number;
  supportedCountries: number;
  productsByStatus: { draft: number; published: number; suspended: number };
}

interface Product {
  id: string; sku: string; title: string; category: string;
  price: number; currency: string; inventory: number;
  platforms: { platform: string; status: string }[];
  status: string; hsCode: string;
}

interface PlatformAccount {
  id: string; platform: string; storeName: string; region: string;
  status: string; productCount: number;
}

interface SupplyChannel {
  id: string; name: string; type: string; country: string; status: string;
}

interface Warehouse {
  id: string; name: string; type: string; country: string; city: string;
  capacity: number; usedCapacity: number;
}

interface ShippingRoute {
  id: string; name: string; type: string;
  origin: { country: string; city: string };
  destination: { country: string; city: string };
  estimatedDays: { min: number; max: number };
}

interface CountryRegulation {
  id: string; country: string; countryCode: string;
  categories: { name: string; tariffRate: number; vatRate: number; prohibited: boolean }[];
}

type TabKey = 'dashboard' | 'channels' | 'platforms' | 'products' | 'logistics' | 'regulations';

const TABS: { key: TabKey; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'dashboard', label: '仪表盘', icon: BarChart3 },
  { key: 'channels', label: '渠道管理', icon: Factory },
  { key: 'platforms', label: '平台管理', icon: Store },
  { key: 'products', label: '商品管理', icon: Package },
  { key: 'logistics', label: '物流管理', icon: Truck },
  { key: 'regulations', label: '法规查询', icon: Shield },
];

const PLATFORM_NAMES: Record<string, string> = {
  amazon: 'Amazon', shopify: 'Shopify', shopee: 'Shopee', lazada: 'Lazada',
  tiktok_shop: 'TikTok Shop', temu: 'Temu', aliexpress: 'AliExpress',
  ebay: 'eBay', walmart: 'Walmart', mercadolibre: 'Mercado Libre',
};

const TYPE_NAMES: Record<string, string> = {
  factory: '工厂', wholesaler: '批发商', distributor: '分销商', brand_direct: '品牌直供', other: '其他',
  domestic: '国内仓', overseas: '海外仓', fba_prep: 'FBA中转仓', bonded: '保税仓',
  express: '国际快递', air_freight: '空运', sea_freight: '海运', rail: '铁路', truck: '卡车',
};

export default function Ecommerce() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [stats, setStats] = useState<EcommerceStats | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [channels, setChannels] = useState<SupplyChannel[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [routes, setRoutes] = useState<ShippingRoute[]>([]);
  const [regulations, setRegulations] = useState<CountryRegulation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complianceResult, setComplianceResult] = useState<any>(null);
  const [complianceHsCode, setComplianceHsCode] = useState('');
  const [complianceCountry, setComplianceCountry] = useState('US');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, prodRes, platRes, chRes, whRes, routeRes, regRes] = await Promise.all([
        fetch('/api/ecommerce/stats', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/products', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/platforms', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/channels', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/warehouses', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/shipping/routes', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/ecommerce/regulations', { headers: authHeaders() }).then(r => r.json()),
      ]);
      if (statsRes.success) setStats(statsRes.stats);
      if (prodRes.success) setProducts(prodRes.products);
      if (platRes.success) setPlatforms(platRes.platforms);
      if (chRes.success) setChannels(chRes.channels);
      if (whRes.success) setWarehouses(whRes.warehouses);
      if (routeRes.success) setRoutes(routeRes.routes);
      if (regRes.success) setRegulations(regRes.regulations);
    } catch (err) {
      setError('数据加载失败，请确保后端已启动');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [activeTab]);

  const checkCompliance = async () => {
    if (!complianceHsCode || !complianceCountry) return;
    try {
      const res = await fetch('/api/ecommerce/regulations/check', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ productId: products[0]?.id, countryCode: complianceCountry }),
      });
      const data = await res.json();
      setComplianceResult(data);
    } catch { setComplianceResult({ compliant: false, error: '查询失败' }); }
  };

  const filteredProducts = products.filter(p => {
    if (searchTerm && !p.title.includes(searchTerm) && !p.sku.includes(searchTerm)) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    return true;
  });

  // ===== 仪表盘 =====
  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: '商品总数', value: stats?.totalProducts || 0, icon: Package, color: 'bg-blue-500' },
          { label: '接入平台', value: stats?.totalPlatforms || 0, icon: Store, color: 'bg-green-500' },
          { label: '供货渠道', value: stats?.totalChannels || 0, icon: Factory, color: 'bg-purple-500' },
          { label: '仓库数', value: stats?.totalWarehouses || 0, icon: WarehouseIcon, color: 'bg-orange-500' },
          { label: '在途物流', value: stats?.activeShipments || 0, icon: Truck, color: 'bg-cyan-500' },
          { label: '支持国家', value: stats?.supportedCountries || 0, icon: Globe, color: 'bg-pink-500' },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <div className={`w-10 h-10 rounded-lg ${item.color} flex items-center justify-center mb-3`}>
              <item.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-gray-800">{item.value}</p>
            <p className="text-xs text-gray-500">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">商品状态分布</h3>
        <div className="flex gap-4">
          {[
            { label: '草稿', count: stats?.productsByStatus?.draft || 0, color: 'bg-yellow-100 text-yellow-700' },
            { label: '已发布', count: stats?.productsByStatus?.published || 0, color: 'bg-green-100 text-green-700' },
            { label: '已下架', count: stats?.productsByStatus?.suspended || 0, color: 'bg-red-100 text-red-700' },
          ].map((item, i) => (
            <div key={i} className={`flex-1 rounded-lg ${item.color} p-4 text-center`}>
              <p className="text-2xl font-bold">{item.count}</p>
              <p className="text-sm">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">AI 能力集成</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { title: 'AI 商品图生成', desc: '用 AI 为商品生成多场景展示图，白底/场景/棚拍', link: '/home' },
            { title: 'AI 多语言翻译', desc: '自动翻译商品标题和描述到目标市场语言', link: '/ai-assistant' },
            { title: 'AI 法规检查', desc: '智能分析商品是否符合目标国家法规要求', link: '#', onClick: () => setActiveTab('regulations') },
            { title: 'OCR 单据识别', desc: '识别报关单/发票/物流单据中的文字', link: '/ocr' },
            { title: 'AI 抠图', desc: '一键移除商品背景，生成白底图', link: '/remove-bg' },
            { title: '智能视频', desc: '生成商品展示短视频，适合 TikTok/Reels', link: '/video-generator' },
          ].map((item, i) => (
            <div key={i} className="p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => item.onClick ? item.onClick() : window.location.href = item.link}>
              <p className="font-medium text-gray-700 text-sm">{item.title}</p>
              <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ===== 渠道管理 =====
  const renderChannels = () => (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        {channels.map(ch => (
          <div key={ch.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-800">{ch.name}</p>
                <p className="text-xs text-gray-500">{TYPE_NAMES[ch.type] || ch.type} · {ch.country}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs ${ch.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {ch.status === 'active' ? '活跃' : '停用'}
              </span>
            </div>
          </div>
        ))}
        {channels.length === 0 && <p className="text-gray-400 col-span-2 text-center py-8">暂无供货渠道，请添加</p>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {warehouses.map(wh => (
          <div key={wh.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <WarehouseIcon className="w-5 h-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">{wh.name}</p>
                <p className="text-xs text-gray-500">{TYPE_NAMES[wh.type] || wh.type} · {wh.country} {wh.city}</p>
              </div>
              <div className="text-right">
                <div className="w-16 h-1.5 bg-gray-200 rounded-full">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.min(100, (wh.usedCapacity / wh.capacity) * 100)}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">{Math.round((wh.usedCapacity / wh.capacity) * 100)}% 已用</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ===== 平台管理 =====
  const renderPlatforms = () => (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {platforms.map(plat => (
        <div key={plat.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-gray-800">{PLATFORM_NAMES[plat.platform] || plat.platform}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs ${plat.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {plat.status === 'connected' ? '已连接' : '已断开'}
            </span>
          </div>
          <p className="text-sm text-gray-600">{plat.storeName}</p>
          <p className="text-xs text-gray-400">{plat.region} · {plat.productCount} 个商品</p>
        </div>
      ))}
      {platforms.length === 0 && (
        <div className="col-span-3 bg-white rounded-xl shadow-sm p-8 text-center border border-gray-100">
          <Store className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">暂未接入平台</p>
          <p className="text-xs text-gray-300 mt-1">支持 Amazon / Shopify / Shopee / Lazada / TikTok Shop / Temu / AliExpress / eBay / Walmart / Mercado Libre</p>
        </div>
      )}
    </div>
  );

  // ===== 商品管理 =====
  const renderProducts = () => (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="搜索商品名称或SKU..." value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="suspended">已下架</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">SKU</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">商品名称</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">价格</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">库存</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">HS编码</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">平台</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">状态</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(prod => (
              <tr key={prod.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{prod.sku}</td>
                <td className="px-4 py-3 font-medium">{prod.title}</td>
                <td className="px-4 py-3">{prod.currency} {prod.price}</td>
                <td className="px-4 py-3">{prod.inventory}</td>
                <td className="px-4 py-3 font-mono text-xs">{prod.hsCode}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {prod.platforms.map((p, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{PLATFORM_NAMES[p.platform] || p.platform}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${prod.status === 'published' ? 'bg-green-100 text-green-700' : prod.status === 'draft' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                    {prod.status === 'published' ? '已发布' : prod.status === 'draft' ? '草稿' : '已下架'}
                  </span>
                </td>
              </tr>
            ))}
            {filteredProducts.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无商品数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ===== 物流管理 =====
  const renderLogistics = () => (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {routes.map(route => (
          <div key={route.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <Ship className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-gray-500">{TYPE_NAMES[route.type] || route.type}</span>
            </div>
            <p className="font-semibold text-gray-800 text-sm">{route.name}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span>{route.origin.country} {route.origin.city}</span>
              <span>→</span>
              <span>{route.destination.country} {route.destination.city}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">预计 {route.estimatedDays.min}-{route.estimatedDays.max} 天</p>
          </div>
        ))}
        {routes.length === 0 && <p className="text-gray-400 col-span-3 text-center py-8">暂无物流路线</p>}
      </div>
    </div>
  );

  // ===== 法规查询 =====
  const renderRegulations = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
        <h3 className="font-semibold text-gray-800 mb-3">合规检查</h3>
        <div className="flex gap-3">
          <input
            type="text" placeholder="HS编码（如 8471）" value={complianceHsCode}
            onChange={e => setComplianceHsCode(e.target.value)}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm"
          />
          <select value={complianceCountry} onChange={e => setComplianceCountry(e.target.value)} className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="US">美国</option>
            <option value="EU">欧盟</option>
            <option value="JP">日本</option>
            <option value="BR">巴西</option>
          </select>
          <button onClick={checkCompliance} className="px-6 py-2.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600">
            检查
          </button>
        </div>
        {complianceResult && (
          <div className={`mt-4 p-4 rounded-lg ${complianceResult.compliant ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`font-medium ${complianceResult.compliant ? 'text-green-700' : 'text-red-700'}`}>
              {complianceResult.compliant ? '✅ 合规' : '❌ 存在限制'}
            </p>
            {complianceResult.restrictions?.length > 0 && (
              <p className="text-sm mt-1">限制: {complianceResult.restrictions.join(', ')}</p>
            )}
            <p className="text-sm mt-1">关税: {complianceResult.estimatedTariff}% · 增值税: {complianceResult.estimatedVat}%</p>
            {complianceResult.requiredDocs?.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">所需文件: {complianceResult.requiredDocs.join(', ')}</p>
            )}
          </div>
        )}
      </div>

      {regulations.map(reg => (
        <div key={reg.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-gray-800">{reg.country} ({reg.countryCode})</h3>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {reg.categories.map((cat, i) => (
              <div key={i} className="p-3 rounded-lg border border-gray-100">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{cat.name}</p>
                  {cat.prohibited ? <XCircle className="w-4 h-4 text-red-500" /> : <CheckCircle className="w-4 h-4 text-green-500" />}
                </div>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>关税 {cat.tariffRate}%</span>
                  <span>增值税 {cat.vatRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8 pt-20">
        <div className="flex items-center gap-3 mb-8">
          <div className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium flex items-center gap-1.5">
            <Globe className="w-4 h-4" />
            跨境电商
          </div>
          <h1 className="text-2xl font-bold text-gray-800">电商管理中心</h1>
          <button onClick={fetchData} className="ml-auto p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="刷新">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 标签页导航 */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl shadow-sm p-1 border border-gray-100 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeTab === tab.key ? 'bg-blue-500 text-white shadow' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        {error && <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>}
        {loading && !stats ? (
          <div className="text-center py-16 text-gray-400">加载中...</div>
        ) : (
          <>
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'channels' && renderChannels()}
            {activeTab === 'platforms' && renderPlatforms()}
            {activeTab === 'products' && renderProducts()}
            {activeTab === 'logistics' && renderLogistics()}
            {activeTab === 'regulations' && renderRegulations()}
          </>
        )}
      </div>
    </div>
  );
}
