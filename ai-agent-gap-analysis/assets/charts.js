(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart 1: 功能维度雷达图 ---
  var chart1 = echarts.init(document.getElementById('chart-radar'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    color: [accent, accent2, muted, accent + '99', accent2 + '99'],
    tooltip: { appendToBody: true },
    legend: { bottom: 0, textStyle: { color: ink }, data: ['AI创意工坊', 'LangGraph', 'CrewAI', 'Google ADK', 'OpenAI SDK'] },
    radar: {
      center: ['50%', '50%'],
      radius: '65%',
      indicator: [
        { name: '多Agent协作', max: 10 },
        { name: '记忆系统', max: 10 },
        { name: 'MCP协议', max: 10 },
        { name: '模型路由', max: 10 },
        { name: '工具生态', max: 10 },
        { name: '企业治理', max: 10 },
        { name: '部署灵活', max: 10 },
        { name: '社区生态', max: 10 }
      ],
      axisName: { color: muted }
    },
    series: [{
      type: 'radar',
      data: [
        { value: [7, 6, 7, 9, 4, 2, 7, 1], name: 'AI创意工坊' },
        { value: [9, 9, 7, 8, 9, 8, 8, 9], name: 'LangGraph' },
        { value: [8, 5, 8, 7, 7, 6, 5, 7], name: 'CrewAI' },
        { value: [9, 8, 9, 8, 8, 8, 8, 7], name: 'Google ADK' },
        { value: [5, 5, 8, 5, 6, 4, 4, 6], name: 'OpenAI SDK' }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart1.resize(); });

  // --- Chart 2: 架构成熟度对比柱状图 ---
  var chart2 = echarts.init(document.getElementById('chart-maturity'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    color: [accent, accent2, '#94a3b8', '#cbd5e1'],
    tooltip: { appendToBody: true, trigger: 'axis' },
    legend: { bottom: 0, textStyle: { color: ink } },
    grid: { left: '15%', right: '5%', top: '10%', bottom: '12%' },
    xAxis: {
      type: 'category',
      data: ['编排器', '记忆系统', '模型路由', 'MCP协议', '安全审核', 'RAG知识库', '流式输出', '多人协作'],
      axisLabel: { color: muted, rotate: 30, fontSize: 11 }
    },
    yAxis: {
      type: 'value', max: 100,
      axisLabel: { color: muted, formatter: '{value}%' },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [
      { name: 'AI创意工坊', type: 'bar', data: [85, 72, 95, 88, 80, 70, 90, 60], barGap: '10%' },
      { name: 'LangGraph', type: 'bar', data: [95, 90, 85, 75, 70, 85, 75, 50] },
      { name: 'CrewAI', type: 'bar', data: [78, 55, 72, 80, 55, 40, 60, 30] },
      { name: 'Google ADK', type: 'bar', data: [92, 88, 82, 92, 78, 82, 78, 45] }
    ]
  });
  window.addEventListener('resize', function() { chart2.resize(); });

  // --- Chart 3: 竞争力定位气泡图 ---
  var chart3 = echarts.init(document.getElementById('chart-positioning'), null, { renderer: 'svg' });
  var bubbleData = [
    { name: 'AI创意工坊', value: [7, 6, 8], itemStyle: { color: accent } },
    { name: 'LangGraph', value: [9, 9, 30], itemStyle: { color: '#6366f1' } },
    { name: 'CrewAI', value: [7.5, 6.5, 20], itemStyle: { color: '#8b5cf6' } },
    { name: 'OpenAI SDK', value: [5, 4, 25], itemStyle: { color: '#10b981' } },
    { name: 'Google ADK', value: [8.5, 8.5, 22], itemStyle: { color: '#f59e0b' } },
    { name: 'Dify', value: [6, 8, 35], itemStyle: { color: '#3b82f6' } },
    { name: 'Coze', value: [5, 7, 28], itemStyle: { color: '#ec4899' } },
    { name: 'Manus', value: [4, 3, 12], itemStyle: { color: '#64748b' } }
  ];
  chart3.setOption({
    animation: false,
    tooltip: {
      appendToBody: true,
      formatter: function(p) { return p.name + '<br/>技术深度: ' + p.value[0] + '<br/>生态广度: ' + p.value[1] + '<br/>社区影响力: ' + p.value[2]; }
    },
    grid: { left: '18%', right: '8%', top: '8%', bottom: '8%' },
    xAxis: {
      name: '技术架构深度',
      nameLocation: 'center', nameGap: 30, nameTextStyle: { color: muted },
      min: 2, max: 10,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      name: '生态集成广度',
      nameLocation: 'center', nameGap: 35, nameTextStyle: { color: muted },
      min: 1, max: 10,
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: rule } }
    },
    series: [{
      type: 'scatter',
      symbolSize: function(data) { return Math.sqrt(data[2]) * 7; },
      data: bubbleData,
      label: {
        show: true,
        formatter: function(p) { return p.name; },
        position: 'right',
        color: ink,
        fontSize: 11
      },
      emphasis: {
        label: { show: true, fontSize: 13, fontWeight: 'bold' }
      }
    }]
  });
  window.addEventListener('resize', function() { chart3.resize(); });

  // --- Chart 4: 差距雷达图 ---
  var chart4 = echarts.init(document.getElementById('chart-gap-radar'), null, { renderer: 'svg' });
  chart4.setOption({
    animation: false,
    color: [accent, accent2],
    tooltip: { appendToBody: true },
    legend: { bottom: 0, textStyle: { color: ink }, data: ['AI创意工坊', '行业最佳'] },
    radar: {
      center: ['50%', '50%'],
      radius: '65%',
      indicator: [
        { name: 'Agent编排', max: 10 },
        { name: '记忆管理', max: 10 },
        { name: '工具协议', max: 10 },
        { name: '模型路由', max: 10 },
        { name: '安全治理', max: 10 },
        { name: 'A2A通信', max: 10 },
        { name: '可观测性', max: 10 },
        { name: '社区生态', max: 10 }
      ],
      axisName: { color: muted }
    },
    series: [{
      type: 'radar',
      data: [
        { value: [7, 6, 7, 9, 5, 2, 3, 1], name: 'AI创意工坊' },
        { value: [9, 9, 9, 8, 9, 9, 9, 9], name: '行业最佳' }
      ]
    }]
  });
  window.addEventListener('resize', function() { chart4.resize(); });
})();