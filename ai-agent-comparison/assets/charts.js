(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: Feature Comparison Radar ---
  (function() {
    var el = document.getElementById('chart-radar');
    if (!el) return;
    var chart = echarts.init(el, null, { renderer: 'svg' });
    chart.setOption({
      animation: false,
      tooltip: { trigger: 'item', appendToBody: true },
      legend: {
        data: ['AI创意工坊', 'Coze', 'Dify', 'CrewAI', 'LangGraph', 'Microsoft AF'],
        bottom: 0,
        textStyle: { color: ink, fontSize: 11 }
      },
      radar: {
        center: ['50%', '52%'],
        radius: '62%',
        axisName: { color: muted, fontSize: 10 },
        indicator: [
          { name: '多Agent协作', max: 10 },
          { name: '多模态生成', max: 10 },
          { name: '模型多样性', max: 10 },
          { name: 'RAG/知识库', max: 10 },
          { name: 'MCP协议', max: 10 },
          { name: '可观测性', max: 10 },
          { name: '安全护栏', max: 10 },
          { name: '私有化部署', max: 10 },
          { name: '易用性', max: 10 },
          { name: '成本效率', max: 10 }
        ],
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(255,255,255,0)'] } },
        axisLine: { lineStyle: { color: rule } },
        splitLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'radar',
        data: [
          { value: [8, 9, 9, 7, 7, 3, 2, 8, 6, 10], name: 'AI创意工坊', symbol: 'circle', symbolSize: 5, itemStyle: { color: accent }, lineStyle: { color: accent, width: 2 }, areaStyle: { color: accent + '18' } },
          { value: [7, 4, 5, 6, 6, 4, 5, 1, 9, 7], name: 'Coze', symbol: 'circle', symbolSize: 5, itemStyle: { color: accent2 }, lineStyle: { color: accent2, width: 2 }, areaStyle: { color: accent2 + '18' } },
          { value: [8, 3, 6, 9, 6, 5, 3, 9, 7, 7], name: 'Dify', symbol: 'circle', symbolSize: 5, itemStyle: { color: '#f59e0b' }, lineStyle: { color: '#f59e0b', width: 2 }, areaStyle: { color: '#f59e0b18' } },
          { value: [9, 2, 4, 4, 5, 3, 2, 8, 5, 6], name: 'CrewAI', symbol: 'circle', symbolSize: 5, itemStyle: { color: '#10b981' }, lineStyle: { color: '#10b981', width: 2 }, areaStyle: { color: '#10b98118' } },
          { value: [8, 2, 5, 7, 8, 9, 5, 8, 3, 5], name: 'LangGraph', symbol: 'circle', symbolSize: 5, itemStyle: { color: '#6366f1' }, lineStyle: { color: '#6366f1', width: 2 }, areaStyle: { color: '#6366f118' } },
          { value: [9, 4, 4, 6, 8, 7, 8, 7, 4, 4], name: 'Microsoft AF', symbol: 'circle', symbolSize: 5, itemStyle: { color: '#ec4899' }, lineStyle: { color: '#ec4899', width: 2 }, areaStyle: { color: '#ec489918' } }
        ]
      }]
    });
    window.addEventListener('resize', function() { chart.resize(); });
  })();

  // --- Chart 2: Feature Coverage Bar Chart ---
  (function() {
    var el = document.getElementById('chart-feature');
    if (!el) return;
    var chart = echarts.init(el, null, { renderer: 'svg' });
    var categories = ['AI对话', '图片生成', '视频生成', '长视频拆分', '智能抠图', '图片合成', 'OCR', '多Agent\n流水线', 'RAG知识库', '调度编排', 'MCP协议', '记忆系统', '可观测性', '安全护栏', '桌面端', 'Electron打包'];
    var data = [
      { name: 'AI创意工坊', data: [1,1,1,1,1,1,1,1,1,1,1,1,0.2,0.1,1,1] },
      { name: 'Coze', data: [1,0.5,0.2,0,0,0,0,0.8,0.8,0.7,0.6,0.6,0.5,0.5,0,0] },
      { name: 'Dify', data: [1,0.3,0.1,0,0,0,0,0.9,1,0.8,0.6,0.5,0.5,0.3,0,0] },
      { name: 'CrewAI', data: [1,0.2,0,0,0,0,0,1,0.5,0.9,0.5,0.4,0.3,0.2,0,0] },
      { name: 'LangGraph', data: [1,0.2,0,0,0,0,0,0.9,0.8,0.9,1,0.7,1,0.6,0,0] },
      { name: 'Microsoft AF', data: [1,0.3,0.1,0,0,0,0,1,0.7,0.9,1,0.7,0.8,1,0,0] }
    ];
    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true, formatter: function(p) { return p.map(function(d) { return d.marker + ' ' + d.seriesName + ': ' + Math.round(d.value * 100) + '%'; }).join('<br/>'); } },
      legend: { data: data.map(function(d) { return d.name; }), bottom: 0, textStyle: { color: ink, fontSize: 11 } },
      grid: { left: 100, right: 20, top: 20, bottom: 50 },
      xAxis: { type: 'value', max: 1, axisLabel: { color: muted, formatter: function(v) { return Math.round(v * 100) + '%'; } }, splitLine: { lineStyle: { color: rule } } },
      yAxis: { type: 'category', data: categories, axisLabel: { color: ink, fontSize: 10 }, axisLine: { lineStyle: { color: rule } } },
      series: data.map(function(d, i) {
        var colors = [accent, accent2, '#f59e0b', '#10b981', '#6366f1', '#ec4899'];
        return { type: 'bar', name: d.name, data: d.data, barGap: i === 0 ? '30%' : '-100%', barWidth: '60%', itemStyle: { color: colors[i], borderRadius: [0, 2, 2, 0], opacity: i === 0 ? 1 : 0.75 }, z: i === 0 ? 6 : 6 - i };
      })
    });
    window.addEventListener('resize', function() { chart.resize(); });
  })();
})();