# publicCalendarView Lightning Web Component 分析文档

## 概述

`publicCalendarView` 是一个功能完整的 Salesforce Lightning Web Component，用于显示公共日历事件。该组件支持周视图和月视图，并具有复杂的事件重叠处理逻辑和事件详情模态框功能。

## 文件结构

- **publicCalendarView.html** - 模板文件，定义组件的UI结构
- **publicCalendarView.js** - 主要的JavaScript逻辑文件  
- **publicCalendarView.css** - 样式文件，定义组件的外观
- **publicCalendarView.js-meta.xml** - 元数据文件，配置组件属性和部署设置

## 核心功能

### 1. 视图模式
- **周视图 (Week View)**: 显示一周的日程，以7天×24小时的网格形式展示
- **月视图 (Month View)**: 显示整月的日程，以传统月历形式展示

### 2. 事件管理
- 支持单次事件和重复事件
- 重复事件自动展开为多个实例
- 事件重叠检测和智能布局
- 事件点击查看详情模态框

### 3. 导航功能
- 前一周/后一周导航
- 前一月/后一月导航  
- 视图切换下拉菜单

## 技术实现细节

### JavaScript (publicCalendarView.js)

#### 主要属性和状态
```javascript
// API属性
@api calendarId;
@api defaultView = 'week';
@api headerToolbar;
@api weekNumbers;
@api eventLimit = 3;

// 跟踪属性
@track events = [];
@track loading = true;
@track error = false;
@track weekDays = [];
@track monthDays = [];
@track viewMode = 'week';
@track showEventModal = false;
```

#### 核心方法

1. **数据获取**
   - `loadCalendarData()` - 加载日历数据
   - `fetchEvents()` - 获取事件数据
   - 调用Apex控制器 `PublicCalendarController.getPublicCalendarEvents`

2. **事件处理**
   - `normalizeEvent()` - 标准化事件数据格式
   - `expandRecurringEvent()` - 展开重复事件
   - `getEventsForDate()` - 获取特定日期的事件

3. **视图构建**
   - `buildWeekView()` - 构建周视图
   - `buildMonthView()` - 构建月视图
   - `refreshView()` - 刷新当前视图

4. **事件布局算法**
   - `calculateConcurrentEventLayout()` - 计算并发事件布局
   - `createOverlapGroups()` - 创建重叠事件组
   - `assignColumnsToOverlapGroup()` - 为重叠事件分配列
   - `eventsOverlap()` - 判断两个事件是否重叠

#### 重复事件处理
组件支持解析RRULE格式的重复模式：
- 支持DAILY频率的重复事件
- 解析INTERVAL和COUNT参数
- 自动生成重复实例
- 限制生成范围（6个月前到6个月后）

#### 事件重叠布局算法
1. **重叠检测**: 检查事件时间是否重叠
2. **分组**: 将重叠的事件分组
3. **列分配**: 为每组内的事件分配列位置
4. **宽度计算**: 根据并发事件数量动态计算宽度
5. **位置计算**: 计算每个事件的精确位置（top, left, width, height）

### HTML模板 (publicCalendarView.html)

#### 结构层次
```html
<div class="calendar-wrapper">
  <!-- 头部工具栏 -->
  <div class="calendar-header">
    <div class="header-left">...</div>
    <div class="header-center">...</div>
    <div class="header-right">...</div>
  </div>
  
  <!-- 周视图 -->
  <template if:true={isWeekView}>
    <div class="week-view">
      <!-- 头部（星期标题） -->
      <div class="week-header">...</div>
      <!-- 主体（时间网格） -->
      <div class="week-body">
        <div class="week-time-column">...</div>
        <div class="week-days-grid">...</div>
      </div>
    </div>
  </template>
  
  <!-- 月视图 -->
  <template if:true={isMonthView}>...</template>
  
  <!-- 事件详情模态框 -->
  <template if:true={showEventModal}>...</template>
</div>
```

#### 关键特性
- 响应式设计，支持移动端
- 条件渲染（周/月视图切换）
- 事件循环渲染（`for:each`）
- 动态CSS类绑定

### CSS样式 (publicCalendarView.css)

#### 样式架构
1. **布局样式**
   - 使用CSS Grid布局周视图
   - Flexbox布局月视图
   - 响应式设计（@media查询）

2. **事件样式**
   - 基础事件块样式
   - 网格定位事件（.grid-positioned）
   - 槽位事件（.slot-positioned）
   - 时间定位事件（.time-positioned）

3. **交互样式**
   - 悬停效果
   - 过渡动画
   - 模态框样式

#### 关键样式类
- `.week-view` - 周视图容器
- `.week-days-grid` - 7天网格容器
- `.event-block.grid-positioned` - 绝对定位的事件块
- `.event-modal` - 事件详情模态框

### 元数据配置 (publicCalendarView.js-meta.xml)

#### 组件属性
- `calendarId` (String) - 日历ID
- `defaultView` (String) - 默认视图模式
- `headerToolbar` (Boolean) - 是否显示头部工具栏
- `weekNumbers` (Boolean) - 是否显示周数
- `eventLimit` (Integer) - 每日事件显示限制

#### 部署目标
- Lightning应用页面
- Lightning记录页面
- Lightning主页
- Experience Cloud页面

## 调试功能

### 控制台日志
组件包含详细的调试日志：
- 使用`LOG_TAG`和`LOG_VERSION`标识
- 关键操作的详细日志记录
- 特殊日期（9月11日）的专项调试

### 开发者工具
- `window.calendarScrollTo()` - 手动滚动到指定位置
- `window.calendarScrollToBottom()` - 滚动到底部
- 详细的事件处理日志

## 性能优化

### 滚动优化
- 时间列和事件网格的同步滚动
- 自动滚动到4AM位置
- 滚动事件监听器管理

### 事件处理优化
- 事件去重机制
- 限制重复事件生成数量（最多100个实例）
- 智能日期范围过滤

### 内存管理
- 组件断开连接时清理事件监听器
- 避免内存泄漏

## 已知问题和改进点

### 当前限制
1. 仅支持DAILY频率的重复事件
2. 最多支持4列并发事件显示
3. 移动端体验可能需要进一步优化

### 潜在改进
1. 支持更多重复频率（WEEKLY, MONTHLY, YEARLY）
2. 改进事件重叠算法的性能
3. 添加事件拖拽功能
4. 改进无障碍访问支持

## 依赖关系

### Apex控制器
- `PublicCalendarController.getPublicCalendarEvents`
- `PublicCalendarController.getPublicCalendars`

### Salesforce LWC框架
- `@lwc/api`, `@lwc/track`
- Lightning Design System组件
- Lightning图标

## 总结

这是一个功能完整且复杂的日历组件，具有良好的架构设计和详细的事件处理逻辑。代码中包含大量调试信息，便于开发和维护。组件支持多种显示模式和交互功能，适用于企业级应用的日历需求。

主要技术亮点包括：
- 复杂的事件重叠处理算法
- 重复事件的智能展开
- 响应式设计和性能优化
- 详细的调试和日志记录机制