// 虚拟列表组件 - 优化大数据量列表性能
// 支持：滚动加载更多、自定义item高度、缓冲渲染

Component({
  properties: {
    // 列表数据
    listData: {
      type: Array,
      value: []
    },
    // 单项高度(rpx)
    itemHeight: {
      type: Number,
      value: 180
    },
    // 可见区域高度(rpx)
    visibleHeight: {
      type: Number,
      value: 800
    },
    // 缓冲项数量
    bufferCount: {
      type: Number,
      value: 5
    },
    // 是否启用滚动加载
    enableLoadMore: {
      type: Boolean,
      value: false
    }
  },

  data: {
    visibleData: [],
    startIndex: 0,
    endIndex: 0,
    totalHeight: 0,
    scrollTop: 0,
    loadMoreLoading: false,
    loadMoreFinished: false
  },

  observers: {
    'listData': function(newData) {
      if (newData) {
        this.calculateVisibleData();
        // 重置加载状态
        this.setData({ loadMoreFinished: false });
      }
    }
  },

  methods: {
    // 计算可见数据
    calculateVisibleData(scrollTop = 0) {
      const itemHeight = this.data.itemHeight;
      const visibleCount = Math.ceil(this.data.visibleHeight / itemHeight);
      const bufferCount = this.data.bufferCount;

      // 计算起始索引
      const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferCount);
      // 计算结束索引
      const endIndex = Math.min(this.properties.listData.length, startIndex + visibleCount + bufferCount * 2);

      this.setData({
        visibleData: this.properties.listData.slice(startIndex, endIndex),
        startIndex,
        endIndex,
        totalHeight: this.properties.listData.length * itemHeight
      });
    },

    // 滚动事件
    onScroll(e) {
      const scrollTop = e.detail.scrollTop;
      const contentHeight = e.detail.scrollHeight - this.data.visibleHeight;
      this.setData({ scrollTop });

      this.calculateVisibleData(scrollTop);

      // 检测是否滚动到底部，触发加载更多
      if (this.properties.enableLoadMore && !this.data.loadMoreFinished) {
        if (scrollTop >= contentHeight - 200) {
          this.triggerLoadMore();
        }
      }
    },

    // 触发加载更多事件
    triggerLoadMore() {
      if (this.data.loadMoreLoading || this.data.loadMoreFinished) {
        return;
      }

      this.setData({ loadMoreLoading: true });
      this.triggerEvent('loadmore');
    },

    // 加载完成回调
    onLoadMoreComplete(e) {
      const { finished } = e.detail || {};
      this.setData({
        loadMoreLoading: false,
        loadMoreFinished: finished || false
      });
    },

    // 刷新列表
    refresh() {
      this.calculateVisibleData();
      this.setData({ loadMoreFinished: false });
    },

    // 滚动到顶部
    scrollToTop() {
      this.setData({ scrollTop: 0 });
      this.calculateVisibleData();
    }
  },

  lifetimes: {
    attached() {
      this.calculateVisibleData();
    }
  }
});
