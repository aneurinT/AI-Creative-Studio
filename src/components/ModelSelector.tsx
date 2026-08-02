import { useEffect } from 'react';
import { useImageStore } from '../store/imageStore';
import { Cpu, Lock, Unlock } from 'lucide-react';

export default function ModelSelector() {
  const { models, selectedModel, setSelectedModel, fetchModels } = useImageStore();

  useEffect(() => {
    if (models.length === 0) {
      fetchModels();
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-purple-500" />
          生成模型
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {models.length === 0 ? (
          <button
            disabled
            className="px-4 py-2 bg-gray-100 text-gray-400 rounded-xl cursor-not-allowed"
          >
            加载中...
          </button>
        ) : (
          models.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id as any)}
              className={`relative px-4 py-2 rounded-xl border-2 transition-all duration-200 ${selectedModel === model.id
                  ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-md'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              title={model.description}
            >
              <span className="flex items-center gap-2">
                {model.requiresKey ? (
                  <Lock className="w-3 h-3 text-amber-500" />
                ) : (
                  <Unlock className="w-3 h-3 text-green-500" />
                )}
                <span className="text-sm font-medium">{model.name}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
