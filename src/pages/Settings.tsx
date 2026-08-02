import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, CheckCircle, AlertCircle, RefreshCw, Eye, EyeOff, Sparkles, Cloud, Cpu, Zap, Film, Video, Globe, Bot } from 'lucide-react';
import Navbar from '@/components/Navbar';

interface ModelConfig {
  apiKey: string;
  modelId?: string;
}

interface ConfigState {
  models: Record<string, ModelConfig | undefined>;
}

interface TestResult {
  success: boolean;
  message: string;
}

interface ModelInfo {
  name: string;
  icon: any;
  description: string;
  color: string;
  requiresModelId: boolean;
  modelIdPlaceholder?: string;
  getKeyUrl?: string;
  category: 'image' | 'video' | 'llm';
}

const modelInfo: Record<string, ModelInfo> = {
  // ===== 图片模型 =====
  wanx: {
    name: '通义万相 图片生成',
    icon: Cloud,
    description: '阿里云文生图服务',
    color: 'bg-blue-500',
    requiresModelId: false,
    getKeyUrl: 'https://bailian.console.aliyun.com/',
    category: 'image',
  },
  cogview: {
    name: '智谱 CogView-4',
    icon: Cpu,
    description: '智谱AI文生图模型',
    color: 'bg-green-500',
    requiresModelId: false,
    getKeyUrl: 'https://www.bigmodel.cn/usercenter/apikeys',
    category: 'image',
  },
  volcengine: {
    name: '火山方舟 Seedream',
    icon: Zap,
    description: '火山引擎大模型平台',
    color: 'bg-orange-500',
    requiresModelId: true,
    modelIdPlaceholder: 'doubao-seedream-4-0-250828',
    getKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    category: 'image',
  },

  // ===== 视频模型 =====
  'cogvideox-flash': {
    name: '智谱 CogVideoX-Flash',
    icon: Film,
    description: '智谱AI免费视频生成模型',
    color: 'bg-emerald-500',
    requiresModelId: false,
    getKeyUrl: 'https://www.bigmodel.cn/usercenter/apikeys',
    category: 'video',
  },
  'wanx-video': {
    name: '通义万相 视频生成',
    icon: Video,
    description: '阿里云万相视频生成 wan2.6',
    color: 'bg-cyan-500',
    requiresModelId: false,
    getKeyUrl: 'https://bailian.console.aliyun.com/',
    category: 'video',
  },
  seedance: {
    name: 'Seedance 2.0 视频',
    icon: Sparkles,
    description: '火山引擎视频生成模型',
    color: 'bg-rose-500',
    requiresModelId: true,
    modelIdPlaceholder: 'seedance-2-0-l-t2v-250828',
    getKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    category: 'video',
  },
  agnes: {
    name: 'Agnes Video V2.0',
    icon: Globe,
    description: '境外视频生成服务（需代理）',
    color: 'bg-indigo-500',
    requiresModelId: false,
    getKeyUrl: 'https://www.runninghub.ai/',
    category: 'video',
  },

  // ===== LLM 模型 =====
  deepseek: {
    name: 'DeepSeek 对话模型',
    icon: Bot,
    description: 'AI 助手对话引擎',
    color: 'bg-violet-500',
    requiresModelId: false,
    getKeyUrl: 'https://platform.deepseek.com/api_keys',
    category: 'llm',
  },
};

const categoryLabels: Record<string, { label: string; icon: any; desc: string }> = {
  image: { label: '图片模型', icon: Cloud, desc: '配置文生图模型的 API Key' },
  video: { label: '视频模型', icon: Film, desc: '配置视频生成模型的 API Key' },
  llm: { label: 'LLM 对话', icon: Bot, desc: '配置 AI 助手的对话模型' },
};

export default function Settings() {
  const [config, setConfig] = useState<ConfigState>({ models: {} });
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/config', { headers });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  const handleSave = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/config', {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMessage('配置保存成功');
        setEditing({});
        setTimeout(() => setSaveMessage(''), 3000);
      }
    } catch (error) {
      setSaveMessage('保存失败');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  const handleTest = async (model: string) => {
    setTesting(prev => ({ ...prev, [model]: true }));
    setTestResults(prev => ({ ...prev, [model]: null }));

    try {
      const modelConfig = config.models[model];
      if (!modelConfig?.apiKey) {
        setTestResults(prev => ({ ...prev, [model]: { success: false, message: '请先输入 API Key' } }));
        setTesting(prev => ({ ...prev, [model]: false }));
        return;
      }

      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/test/model', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          apiKey: modelConfig.apiKey,
          modelId: modelConfig.modelId,
        }),
      });

      const data = await res.json();
      setTestResults(prev => ({ ...prev, [model]: data }));
    } catch (error) {
      setTestResults(prev => ({ ...prev, [model]: { success: false, message: `测试失败: ${(error as Error).message}` } }));
    } finally {
      setTesting(prev => ({ ...prev, [model]: false }));
    }
  };

  const handleApiKeyChange = (model: string, value: string) => {
    setConfig(prev => ({
      models: {
        ...prev.models,
        [model]: { ...prev.models[model], apiKey: value, modelId: prev.models[model]?.modelId },
      },
    }));
  };

  const handleModelIdChange = (model: string, value: string) => {
    setConfig(prev => ({
      models: {
        ...prev.models,
        [model]: { ...prev.models[model], apiKey: prev.models[model]?.apiKey || '', modelId: value },
      },
    }));
  };

  const toggleEdit = (model: string) => {
    setEditing(prev => ({ ...prev, [model]: !prev[model] }));
    if (editing[model]) {
      setTestResults(prev => ({ ...prev, [model]: null }));
    }
  };

  const toggleShowKey = (model: string) => {
    setShowKeys(prev => ({ ...prev, [model]: !prev[model] }));
  };

  // 按分类分组模型
  const categories = ['image', 'video', 'llm'] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 py-8 pt-20">
        {/* 页面标题 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <SettingsIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">模型配置</h1>
              <p className="text-sm text-gray-500">配置您的大模型 API Key，配置后即可使用对应模型生成图片和视频</p>
            </div>
          </div>

          {saveMessage && (
            <div className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-2 ${saveMessage.includes('成功') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {saveMessage.includes('成功') ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {saveMessage}
            </div>
          )}
        </div>

        {/* 按分类展示模型 */}
        {categories.map(cat => {
          const catInfo = categoryLabels[cat];
          const CatIcon = catInfo.icon;
          const catModels = Object.entries(modelInfo).filter(([, info]) => info.category === cat);

          return (
            <div key={cat} className="bg-white rounded-2xl shadow-lg p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <CatIcon className="w-5 h-5 text-purple-500" />
                <h2 className="text-lg font-bold text-gray-800">{catInfo.label}</h2>
                <span className="text-sm text-gray-400">— {catInfo.desc}</span>
              </div>

              <div className="space-y-4">
                {catModels.map(([model, info]) => {
                  const Icon = info.icon;
                  const modelConfig = config.models[model];
                  const isConfigured = modelConfig?.apiKey;

                  return (
                    <div
                      key={model}
                      className={`p-4 rounded-xl border-2 transition-all ${isConfigured ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 ${info.color} rounded-xl flex items-center justify-center`}>
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-800 text-sm">{info.name}</h3>
                            <p className="text-xs text-gray-500">{info.description}</p>
                            {info.getKeyUrl && (
                              <a href={info.getKeyUrl} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-purple-500 hover:text-purple-600 underline mt-0.5 inline-block">
                                获取 API Key →
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {testResults[model] && (
                            <div className={`px-2 py-1 rounded-lg text-xs flex items-center gap-1 ${testResults[model]!.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {testResults[model]!.success ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              {testResults[model]!.success ? '通过' : '失败'}
                            </div>
                          )}
                          <button
                            onClick={() => toggleEdit(model)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${editing[model] ? 'bg-gray-200 text-gray-700' : 'bg-purple-500 text-white hover:bg-purple-600'}`}
                          >
                            {editing[model] ? '收起' : isConfigured ? '修改' : '配置'}
                          </button>
                        </div>
                      </div>

                      {editing[model] && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                            <div className="relative">
                              <input
                                type={showKeys[model] ? 'text' : 'password'}
                                value={modelConfig?.apiKey || ''}
                                onChange={(e) => handleApiKeyChange(model, e.target.value)}
                                placeholder="粘贴您的 API Key"
                                className="w-full px-3 py-2 pr-10 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none transition-all text-sm"
                              />
                              <button
                                onClick={() => toggleShowKey(model)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                                {showKeys[model] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {info.requiresModelId && (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Model ID</label>
                              <input
                                type="text"
                                value={modelConfig?.modelId || ''}
                                onChange={(e) => handleModelIdChange(model, e.target.value)}
                                placeholder={info.modelIdPlaceholder || '请输入 Model ID'}
                                className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none transition-all text-sm"
                              />
                            </div>
                          )}

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleTest(model)}
                              disabled={testing[model]}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${testing[model] ? 'bg-gray-200 text-gray-500' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${testing[model] ? 'animate-spin' : ''}`} />
                              {testing[model] ? '测试中...' : '测试连接'}
                            </button>

                            {testResults[model] && (
                              <p className={`text-xs ${testResults[model]!.success ? 'text-green-600' : 'text-red-500'}`}>
                                {testResults[model]!.message}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {!editing[model] && isConfigured && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="w-3 h-3" />
                          API Key 已配置
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 保存按钮 */}
        <div className="bg-white rounded-2xl shadow-lg p-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            <p>配置的 API Key 保存在服务器端，不会上传到第三方</p>
            <p className="mt-0.5">Trae AI 图片生成为内置免费服务，无需配置</p>
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:shadow-lg transition-all text-sm"
          >
            <Save className="w-4 h-4" />
            保存全部配置
          </button>
        </div>

        {/* 使用说明 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mt-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            使用说明
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
            <div className="flex items-start gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">1</span>
              <p>点击模型的「配置」按钮，粘贴从各平台获取的 API Key</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">2</span>
              <p>点击「测试连接」验证 API Key 是否有效</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">3</span>
              <p>验证通过后点击底部「保存全部配置」</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-5 h-5 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">4</span>
              <p>配置完成后即可在首页/视频页选择对应模型生成</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
