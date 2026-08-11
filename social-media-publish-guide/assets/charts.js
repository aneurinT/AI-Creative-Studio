// AI 创意工坊 — 自媒体发布指南图表
(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var success = style.getPropertyValue('--success').trim();
  var warning = style.getPropertyValue('--warning').trim();

  // --- Chart: 平台发布参数对比 (雷达图) ---
  var radarChart = echarts.init(document.getElementById('chart-platform-radar'), null, { renderer: 'svg' });
  radarChart.setOption({
    animation: false,
    tooltip: { appendToBody: true },
    legend: {
      data: ['抖音', '快手', '小红书'],
      bottom: 0,
      textStyle: { color: ink }
    },
    radar: {
      center: ['50%', '45%'],
      radius: '65%',
      indicator: [
        { name: '标题长度', max: 60 },
        { name: '正文长度(百字)', max: 50 },
        { name: '视频时长(分钟)', max: 15 },
        { name: '标签数量', max: 10 },
        { name: '图片支持', max: 1 },
        { name: '视频支持', max: 1 }
      ],
      axisName: { color: muted }
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: [55, 50, 15, 10, 1, 1],
          name: '抖音',
          lineStyle: { color: accent },
          areaStyle: { color: accent + '33' },
          itemStyle: { color: accent },
          symbol: 'circle'
        },
        {
          value: [50, 30, 10, 8, 1, 1],
          name: '快手',
          lineStyle: { color: accent2 },
          areaStyle: { color: accent2 + '33' },
          itemStyle: { color: accent2 },
          symbol: 'circle'
        },
        {
          value: [20, 10, 5, 10, 1, 1],
          name: '小红书',
          lineStyle: { color: success },
          areaStyle: { color: success + '33' },
          itemStyle: { color: success },
          symbol: 'circle'
        }
      ]
    }]
  });

  // --- Chart: API 端点使用频率 (柱状图) ---
  var barChart = echarts.init(document.getElementById('chart-api-usage'), null, { renderer: 'svg' });
  barChart.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      formatter: function (p) { return p.name + '<br/>调用频率: ' + p.value + '%'; }
    },
    grid: { left: '3%', right: '8%', top: '10%', bottom: '5%', containLabel: true },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { formatter: '{value}%', color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: 'category',
      data: ['一键多平台发布', '发布历史查询', '平台授权', '单平台发布', '健康检查'],
      axisLabel: { color: ink },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'bar',
      data: [
        { value: 95, itemStyle: { color: accent } },
        { value: 80, itemStyle: { color: accent2 } },
        { value: 60, itemStyle: { color: warning } },
        { value: 45, itemStyle: { color: accent + '99' } },
        { value: 30, itemStyle: { color: accent2 + '99' } }
      ],
      barWidth: 22,
      showBackground: true,
      backgroundStyle: { color: bg2, borderRadius: [0, 4, 4, 0] },
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      label: {
        show: true,
        position: 'right',
        formatter: '{c}%',
        color: muted,
        fontSize: 12
      }
    }]
  });

  window.addEventListener('resize', function () {
    radarChart.resize();
    barChart.resize();
  });
})();