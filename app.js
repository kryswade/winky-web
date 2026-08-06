import { BaseApp } from '@zeppos/zml/base-app'

App(
  BaseApp({
    globalData: { profile: null },
    onCreate() { console.log('Winky Community app onCreate') },
    onDestroy() { console.log('Winky Community app onDestroy') }
  })
)
