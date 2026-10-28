package com.travelapp.passportvault

import android.content.Context
import android.view.WindowManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Raz (design approval, blocker 1): FLAG_SECURE on the window that holds this
 * view. A React Native Modal is a dialog with its own window, which
 * expo-screen-capture (the activity's window) doesn't reach. Set when the view
 * is attached, restored when it leaves; screenshots and the recent-apps
 * preview then show nothing.
 */
class SecureWindowView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var addedFlag = false

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    update(secure = true)
  }

  override fun onDetachedFromWindow() {
    update(secure = false)
    super.onDetachedFromWindow()
  }

  private fun update(secure: Boolean) {
    val root = rootView ?: return
    val params = root.layoutParams as? WindowManager.LayoutParams ?: return
    val has = params.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    if (secure && !has) {
      params.flags = params.flags or WindowManager.LayoutParams.FLAG_SECURE
      addedFlag = true
    } else if (!secure && has && addedFlag) {
      params.flags = params.flags and WindowManager.LayoutParams.FLAG_SECURE.inv()
      addedFlag = false
    } else {
      return
    }
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    try {
      wm.updateViewLayout(root, params)
    } catch (e: IllegalArgumentException) {
      // The window is already gone (the modal closed first): nothing to restore.
    }
  }
}
