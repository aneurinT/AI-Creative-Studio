(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var accent3 = style.getPropertyValue('--accent3').trim();
  var accent4 = style.getPropertyValue('--accent4').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var danger = style.getPropertyValue('--danger').trim();

  // --- Chart 1: Radar Comparison ---
  var radarChart = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  radarChart.setOption({
    animation: false,
    legend: {
      data: ['本项目', '可灵 3.0', 'Runway Gen-4', 'LibTV', '即梦 Seedance 2.0'],
      bottom: 0,
      textStyle: { color: muted, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8
    },
    radar: {
      indicator: [
        { name: '生成质量', max: 10 },
        { name: '原生音频', max: 10 },
        { name: '角色一致性', max: 10 },
        { name: '创作工作流', max: 10 },
        { name: '模型聚合', max: 10 },
        { name: 'Agent 编排', max: 10 },
        { name: '本地推理', max: 10 },
        { name: '社交发布', max: 10 }
      ],
      center: ['50%', '48%'],
      radius: '62%',
      splitNumber: 5,
      axisName: {
        color: ink,
        fontSize: 11
      },
      splitLine: {
        lineStyle: { color: rule }
      },
      splitArea: {
        areaStyle: {
          color: [bg2, 'transparent']
        }
      },
      axisLine: {
        lineStyle: { color: rule }
      }
    },
    series: [{
      type: 'radar',
      data: [
        {
          value: [6, 0, 0, 5, 9, 9, 8, 8],
          name: '本项目',
          lineStyle: { color: accent, width: 2 },
          areaStyle: { color: accent, opacity: 0.15 },
          itemStyle: { color: accent }
        },
        {
          value: [9, 9, 10, 2, 2, 0, 0, 0],
          name: '可灵 3.0',
          lineStyle: { color: accent3, width: 1.5 },
          areaStyle: { color: accent3, opacity: 0.05 },
          itemStyle: { color: accent3 }
        },
        {
          value: [8, 8, 9, 7, 3, 0, 0, 0],
          name: 'Runway Gen-4',
          lineStyle: { color: accent2, width: 1.5 },
          areaStyle: { color: accent2, opacity: 0.05 },
          itemStyle: { color: accent2 }
        },
        {
          value: [7, 5, 8, 10, 8, 9, 0, 0],
          name: 'LibTV',
          lineStyle: { color: accent4, width: 1.5 },
          areaStyle: { color: accent4, opacity: 0.05 },
          itemStyle: { color: accent4 }
        },
        {
          value: [7, 8, 0, 4, 2, 0, 0, 5],
          name: '即梦 Seedance 2.0',
          lineStyle: { color: danger, width: 1.5 },
          areaStyle: { color: danger, opacity: 0.05 },
          itemStyle: { color: danger }
        }
      ]
    }]
  });
  window.addEventListener('resize', function() { radarChart.resize(); });

  // --- Chart 2: Gap Bar Chart ---
  var gapChart = echarts.init(document.getElementById('chart-gap'), null, { renderer: 'svg' });
  gapChart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: bg2,
      borderColor: rule,
      textStyle: { color: ink },
      appendToBody: true
    },
    legend: {
      data: ['本项目', '市场最佳'],
      top: 0,
      textStyle: { color: muted, fontSize: 11 },
      itemWidth: 14,
      itemHeight: 8
    },
    grid: {
      left: '3%',
      right: '6%',
      bottom: '3%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      max: 10,
      splitLine: { lineStyle: { color: rule } },
      axisLabel: { color: muted, fontSize: 11 }
    },
    yAxis: {
      type: 'category',
      data: ['原生音频', '角色一致性', '4K输出', '无限画布', '运动控制', '生成速度', '视频编辑', '模型聚合', 'Agent编排', '本地推理', '社交发布'],
      axisLine: { lineStyle: { color: rule } },
      axisLabel: { color: ink, fontSize: 11 }
    },
    series: [
      {
        name: '本项目',
        type: 'bar',
        data: [0, 0, 3, 0, 2, 3, 5, 9, 9, 8, 8],
        itemStyle: {
          color: function(params) {
            var val = params.value;
            if (val <= 2) return danger;
            if (val <= 5) return accent3;
            return accent;
          },
          borderRadius: [0, 4, 4, 0]
        },
        barWidth: '35%'
      },
      {
        name: '市场最佳',
        type: 'bar',
        data: [9, 10, 10, 10, 9, 8, 9, 8, 9, 0, 5],
        itemStyle: {
          color: accent2,
          borderRadius: [0, 4, 4, 0]
        },
        barWidth: '35%'
      }
    ]
  });
  window.addEventListener('resize', function() { gapChart.resize(); });
})();
