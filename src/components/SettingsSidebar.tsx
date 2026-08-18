import React, { useState, useEffect, useRef } from 'react';

// 用于设置界面侧边栏的组件
const SettingsSidebar = () => {
  const [isScrollable, setIsScrollable] = useState(false);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const sidebarRef = useRef(null);

  // 检测侧边栏是否需要滚动
  useEffect(() => {
    const handleResize = () => {
      if (sidebarRef.current) {
        const computedStyle = window.getComputedStyle(sidebarRef.current);
        const height = parseInt(computedStyle.height, 10);
        setSidebarHeight(height);
        setIsScrollable(height > 500); // 如果高度超过500px，需要滚动
      }
    };

    // 初始化时检测
    handleResize();
    window.addEventListener('resize', handleResize);
    
    // 监听内容变化（当插件添加或移除时）
    const observer = new MutationObserver(() => {
      handleResize();
    });
    
    if (sidebarRef.current) {
      observer.observe(sidebarRef.current, {
        childList: true,
        subtree: true
      });
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  // 获取当前所有的插件设置项
  const getPluginItems = () => {
    // 这里需要获取动态的插件列表
    // 假设有一个全局的插件管理API
    try {
      // 获取所有激活的插件
      const plugins = window.dsh?.plugins?.getActivePlugins() || [];
      
      // 检测是否有动态插件列表
      if (plugins.length > 0) {
        // 过滤出那些提供设置项的插件
        const settingsItems = plugins
          .filter(plugin => plugin?.metadata?.settings)
          .map(plugin => ({
            name: plugin.metadata.settings.name || plugin.metadata.name,
            id: plugin.metadata.settings.id || plugin.metadata.id,
            icon: plugin.metadata.settings.icon || 'default'
          }));
        
        // 添加默认设置项
        const defaultItems = [
          { name: '通用设置', id: 'general' },
          { name: '模型', id: 'models' },
          { name: '插件', id: 'plugins' },
          { name: 'Agent 预设', id: 'agent-presets' },
          { name: '记忆系统', id: 'memory-system' },
          { name: '快照', id: 'snapshots' },
          { name: '插件市场', id: 'plugin-market' },
          { name: '文件拖入', id: 'file-drag' },
          { name: '文件提及', id: 'file-mention' },
          { name: '通知', id: 'notifications' },
          { name: '自定义提示词', id: 'custom-prompts' },
          { name: 'WSL 后端', id: 'wsl-backend' },
          { name: '第三方模型思考...', id: 'third-party-think' },
          { name: '归档对话管理', id: 'archived-dialogs' },
          { name: '侧边临时会话', id: 'side-temp-session' },
          { name: 'Skill 调度器', id: 'skill-scheduler' },
          { name: 'Git 面板', id: 'git-panel' }
        ];
        
        // 将默认项和插件项合并
        return [...defaultItems, ...settingsItems];
      }
    } catch (error) {
      // 如果无法获取插件列表，使用静态列表
      console.warn('无法获取动态插件列表:', error);
      return [
        { name: '通用设置', id: 'general' },
        { name: '模型', id: 'models' },
        { name: '插件', id: 'plugins' },
        { name: 'Agent 预设', id: 'agent-presets' },
        { name: '记忆系统', id: 'memory-system' },
        { name: '快照', id: 'snapshots' },
        { name: '插件市场', id: 'plugin-market' },
        { name: '文件拖入', id: 'file-drag' },
        { name: '文件提及', id: 'file-mention' },
        { name: '通知', id: 'notifications' },
        { name: '自定义提示词', id: 'custom-prompts' },
        { name: 'WSL 后端', id: 'wsl-backend' },
        { name: '第三方模型思考...', id: 'third-party-think' },
        { name: '归档对话管理', id: 'archived-dialogs' },
        { name: '侧边临时会话', id: 'side-temp-session' },
        { name: 'Skill 调度器', id: 'skill-scheduler' },
        { name: 'Git 面板', id: 'git-panel' }
      ];
    }
  };

  return (
    <div ref={sidebarRef} className=