import React, { useState, useCallback } from 'react';

interface ImageUploaderProps {
  onImageUploaded: (imageUrl: string) => void;
  onGenerateVideo: (imageUrl: string) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageUploaded, onGenerateVideo }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileChange = useCallback(async (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      return;
    }

    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        const fullUrl = `${result.imageUrl}`;
        setPreviewUrl(fullUrl);
        onImageUploaded(fullUrl);
        setProgress(100);
      } else {
        alert(`上传失败: ${result.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }, [onImageUploaded]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    handleFileChange(file);
  }, [handleFileChange]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        handleFileChange(file);
      }
    };
    input.click();
  }, [handleFileChange]);

  const handleGenerateVideo = useCallback(async () => {
    if (!previewUrl) return;

    setGenerating(true);

    const match = previewUrl.match(/\/uploads\/(.+)/);
    if (!match) {
      alert('无法获取图片路径');
      setGenerating(false);
      return;
    }

    const imagePath = `/uploads/${match[1]}`;

    try {
      const response = await fetch('/api/upload/image/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: imagePath,
          style: 'realistic',
          duration: '10',
        }),
      });

      const result = await response.json();

      if (result.success) {
        onGenerateVideo(result.videoUrl || '');
      } else {
        alert(`生成失败: ${result.error}`);
      }
    } catch (error) {
      console.error('Video generation error:', error);
      alert('生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }, [previewUrl, onGenerateVideo]);

  const handleClear = useCallback(() => {
    setPreviewUrl('');
    setProgress(0);
  }, []);

  return (
    <div>
      {!previewUrl ? (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
            isDragging
              ? 'border-purple-500 bg-purple-50'
              : 'border-gray-300 bg-gray-50 hover:border-purple-400 hover:bg-purple-50/50'
          }`}
        >
          <div className="text-4xl mb-4">📷</div>
          <p className="text-gray-600 mb-2">
            点击或拖拽图片到此处 <span className="text-purple-600 font-medium">上传图片制作视频</span>
          </p>
          <p className="text-gray-400 text-sm">支持 JPG、PNG、WebP、GIF 格式，最大 10MB</p>
        </div>
      ) : (
        <div className="mt-5">
          <img
            src={previewUrl}
            alt="Uploaded preview"
            className="w-full max-h-64 object-contain rounded-lg"
          />
          <div className="flex gap-3 mt-4 justify-center">
            <button
              onClick={handleGenerateVideo}
              disabled={generating}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                generating
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              }`}
            >
              {generating ? '生成视频中...' : '生成视频'}
            </button>
            <button
              onClick={handleClear}
              className="px-6 py-2.5 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all border border-gray-300"
            >
              重新上传
            </button>
          </div>
        </div>
      )}

      {(uploading || generating) && (
        <div className="mt-4 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default ImageUploader;