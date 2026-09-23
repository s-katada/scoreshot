// Copyright 2021-2025 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0

use objc2::{define_class, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{
  NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString, NSUserActivity,
};
use objc2_ui_kit::{
  UIApplication, UIOpenURLContext, UIScene, UISceneConnectionOptions, UISceneDelegate,
  UISceneSession, UIWindowScene,
};

use crate::{
  event::{Event, WindowEvent},
  platform_impl::platform::{app_state, event_loop::EventWrapper},
  window::WindowId as RootWindowId,
};

// true when the app enabled `UIApplicationSupportsMultipleScenes` in its Info.plist
// and the device allows it to display multiple scenes
// https://developer.apple.com/documentation/uikit/uiapplication/supportsmultiplescenes?language=objc
pub unsafe fn app_supports_multiple_scenes() -> bool {
  let mtm = MainThreadMarker::new().unwrap();
  let application = UIApplication::sharedApplication(mtm);
  application.supportsMultipleScenes()
}

// scoreshot: tao 0.37.0 から持ち込み (#7)。0.35.3 は `UIApplicationSupportsMultipleScenes`
// が true のときしかシーンのライフサイクルとみなさず、false のアプリではウィンドウが
// シーンにつながらずに画面が出なかった
//
// check whether the app adopted the scene lifecycle by declaring a
// `UIApplicationSceneManifest` in its Info.plist
//
// such apps get their windows and their lifecycle callbacks from a `UISceneDelegate`
// instead of the application delegate, so a `UIWindow` is only visible once it is
// attached to a scene
// https://developer.apple.com/documentation/bundleresources/information-property-list/uiapplicationscenemanifest
pub unsafe fn scene_lifecycle_enabled() -> bool {
  let bundle = NSBundle::mainBundle();
  let Some(info) = bundle.infoDictionary() else {
    return false;
  };

  let key = NSString::from_str("UIApplicationSceneManifest");
  (*info).objectForKey(&key).is_some()
}

define_class!(
  #[unsafe(super(NSObject))]
  #[name = "TaoSceneDelegate"]
  #[thread_kind = MainThreadOnly]
  pub struct TaoSceneDelegate;

  unsafe impl NSObjectProtocol for TaoSceneDelegate {}

  #[allow(non_snake_case)]
  unsafe impl UISceneDelegate for TaoSceneDelegate {
    #[unsafe(method(scene:willConnectToSession:options:))]
    fn scene_willConnectToSession_options(
      &self,
      scene: &UIScene,
      _session: &UISceneSession,
      connection_options: &UISceneConnectionOptions,
    ) {
      unsafe {
        app_state::connect_scene(scene, connection_options);
      }
    }

    #[unsafe(method(sceneDidDisconnect:))]
    fn sceneDidDisconnect(&self, _scene: &UIScene) {}

    #[unsafe(method(sceneDidBecomeActive:))]
    fn sceneDidBecomeActive(&self, scene: &UIScene) {
      unsafe {
        if let Some(window_scene) = scene.downcast_ref::<UIWindowScene>() {
          for window in window_scene.windows() {
            app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::WindowEvent {
              window_id: RootWindowId(window.into()),
              event: WindowEvent::Focused(true),
            }));
          }
        }
      }
    }

    #[unsafe(method(sceneWillResignActive:))]
    fn sceneWillResignActive(&self, scene: &UIScene) {
      unsafe {
        if let Some(window_scene) = scene.downcast_ref::<UIWindowScene>() {
          for window in window_scene.windows() {
            app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::WindowEvent {
              window_id: RootWindowId(window.into()),
              event: WindowEvent::Focused(false),
            }));
          }
        }
        // scoreshot: シーンのライフサイクルでは applicationWillResignActive: が
        // 呼ばれないので、ここで出す (0.37.0 はウィンドウごとの WindowEvent::Suspended
        // に変えたが、tauri-runtime-wry 2 系が受けるのはこちら)
        app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::Suspended));
      }
    }

    #[unsafe(method(sceneWillEnterForeground:))]
    fn sceneWillEnterForeground(&self, _scene: &UIScene) {
      // scoreshot: applicationWillEnterForeground: の代わり (上と同じ理由)
      unsafe {
        app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::Resumed));
      }
    }

    #[unsafe(method(sceneDidEnterBackground:))]
    fn sceneDidEnterBackground(&self, _scene: &UIScene) {}

    #[unsafe(method(scene:openURLContexts:))]
    fn scene_openURLContexts(&self, _scene: &UIScene, url_contexts: &NSSet<UIOpenURLContext>) {
      unsafe {
        let urls: Vec<url::Url> = url_contexts
          .iter()
          .filter_map(|ctx| {
            ctx.URL().absoluteString().and_then(|url| {
              let url = url.to_string();
              url
                .parse()
                .map_err(|e| {
                  log::error!("failed to parse URL {url} from scene:openURLContexts: {e}");
                  e
                })
                .ok()
            })
          })
          .collect();
        if !urls.is_empty() {
          app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::Opened { urls }));
        }
      }
    }

    #[unsafe(method(stateRestorationActivityForScene:))]
    fn stateRestorationActivityForScene(
      &self,
      _scene: &UIScene,
    ) -> Option<std::ptr::NonNull<NSUserActivity>> {
      None
    }

    #[unsafe(method(scene:restoreInteractionStateWithUserActivity:))]
    fn scene_restoreInteractionStateWithUserActivity(
      &self,
      _scene: &UIScene,
      _state_restoration_activity: &NSUserActivity,
    ) {
    }

    #[unsafe(method(scene:willContinueUserActivityWithType:))]
    fn scene_willContinueUserActivityWithType(
      &self,
      _scene: &UIScene,
      _user_activity_type: &NSString,
    ) {
    }

    #[unsafe(method(scene:continueUserActivity:))]
    fn scene_continueUserActivity(&self, _scene: &UIScene, user_activity: &NSUserActivity) {
      unsafe {
        // universal app links
        if let Some(url) = user_activity
          .webpageURL()
          .and_then(|url| url.absoluteString())
        {
          let url = url.to_string().parse::<url::Url>().unwrap();
          app_state::handle_nonuser_event(EventWrapper::StaticEvent(Event::Opened {
            urls: vec![url],
          }));
        }
      }
    }

    #[unsafe(method(scene:didFailToContinueUserActivityWithType:error:))]
    fn scene_didFailToContinueUserActivityWithType_error(
      &self,
      _scene: &UIScene,
      _user_activity_type: &NSString,
      _error: &NSError,
    ) {
    }

    #[unsafe(method(scene:didUpdateUserActivity:))]
    fn scene_didUpdateUserActivity(&self, _scene: &UIScene, _user_activity: &NSUserActivity) {}
  }
);
