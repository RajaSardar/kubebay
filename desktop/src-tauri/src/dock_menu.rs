//! The Dock icon's right-click menu (macOS). Tauri has no API for it, so this
//! adds the `applicationDockMenu:` delegate method to the NSApplication
//! delegate's class at runtime, plus a `kubebayNewWindow:` action it targets.

use std::sync::OnceLock;

use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyObject, Sel};
use objc2::{sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::NSString;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Runs on the main thread when "New Window" is chosen in the Dock menu.
unsafe extern "C" fn new_window_action(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) {
    if let Some(app) = APP.get() {
        crate::open_window(app);
    }
}

/// Returns the (autoreleased) menu macOS shows above the Dock icon's items.
unsafe extern "C" fn dock_menu(this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return std::ptr::null_mut();
    };
    let menu = NSMenu::new(mtm);
    let item = NSMenuItem::initWithTitle_action_keyEquivalent(
        NSMenuItem::alloc(mtm),
        &NSString::from_str("New Window"),
        Some(sel!(kubebayNewWindow:)),
        &NSString::from_str(""),
    );
    let target = this.as_ref();
    item.setTarget(target);
    menu.addItem(&item);
    objc2::rc::Retained::autorelease_return(menu)
}

/// Installs the Dock menu on the app delegate. Call once from the main
/// thread after the app (and so tao's delegate) exists, e.g. in `setup`.
pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = ns_app.delegate() else {
        eprintln!("[kubebay] dock menu: no application delegate");
        return;
    };
    let obj: &AnyObject = unsafe { &*(objc2::rc::Retained::as_ptr(&delegate) as *const AnyObject) };
    let cls = obj.class() as *const _ as *mut _;
    unsafe {
        let ok1 = class_addMethod(
            cls,
            sel!(applicationDockMenu:),
            std::mem::transmute(dock_menu as unsafe extern "C" fn(_, _, _) -> _),
            c"@@:@".as_ptr(),
        );
        let ok2 = class_addMethod(
            cls,
            sel!(kubebayNewWindow:),
            std::mem::transmute(new_window_action as unsafe extern "C" fn(_, _, _)),
            c"v@:@".as_ptr(),
        );
        if !(ok1.as_bool() && ok2.as_bool()) {
            eprintln!("[kubebay] dock menu: could not add methods (already present?)");
        }
    }
}
