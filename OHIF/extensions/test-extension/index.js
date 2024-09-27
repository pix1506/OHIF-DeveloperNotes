// extensions/extension-example/src/index.js

import React from 'react';
import OHIF from '@ohif/viewer';
import MyButton from '../MyButton';

OHIF.extensionsManager.registerExtension({
  id: 'example',
  getToolbarModule() {
    return {
      definitions: [
        {
          id: 'myButton',
          label: 'My Button',
          icon: 'exclamation',
          type: 'button',
          onClick: ({ servicesManager }) => {
            // 這裡可以添加按鈕點擊邏輯
            const { UINotificationService } = servicesManager.services;
            UINotificationService.show({
              title: 'My Button',
              message: 'Button clicked!',
              type: 'info',
            });
          },
        },
      ],
      defaultContext: 'ACTIVE_VIEWPORT::CORNERSTONE',
    };
  },
  getPanelModule() {
    return {
      menuOptions: [
        {
          icon: 'exclamation',
          label: 'My Panel',
          target: 'myPanel',
        },
      ],
      components: [
        {
          id: 'myPanel',
          component: MyButton,
        },
      ],
    };
  },
});
