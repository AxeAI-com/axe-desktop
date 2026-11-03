// axe-hands: reads and drives other Mac apps through the Accessibility API for Axe AI's desktop app.
// Ported from Packages/ImperiumKit/Sources/ImperiumHands/{Accessibility,Keyboard}.swift: the same
// tree VoiceOver uses, no screenshots or pixel guessing. One process per app run, so element numbers
// from the last read stay valid. Talks JSON, one object per line, on stdin and stdout:
//   {"id":1,"cmd":"read","app":"Notes"} -> {"id":1,"ok":true,"result":"App: Notes\n…"}
// Commands: trusted, read {app?, limit?}, press {element}, type {text, element?}, keys {keys},
// label {element}, lastApp. Never asks for permission itself; the app asks just in time.

import AppKit
import ApplicationServices
import Carbon.HIToolbox

struct HandsError: Error { let message: String }

@MainActor
final class Hands {
    private var elements: [Int: AXUIElement] = [:]
    private var lastApp: NSRunningApplication?

    static var isTrusted: Bool { AXIsProcessTrusted() }

    private func find(_ name: String) -> NSRunningApplication? {
        // "pid:123": one exact process (self-tests point at their own window this way).
        if name.hasPrefix("pid:"), let pid = Int32(name.dropFirst(4)) { return NSRunningApplication(processIdentifier: pid) }
        let n = name.lowercased().replacingOccurrences(of: "@", with: "").replacingOccurrences(of: ".app", with: "")
        let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        if let app = running.first(where: { $0.localizedName?.lowercased() == n || $0.bundleIdentifier?.lowercased() == n }) { return app }
        let key = n.filter { $0.isLetter || $0.isNumber }
        guard key.count >= 3 else { return nil }
        return running.first { ($0.localizedName ?? "").lowercased().filter { $0.isLetter || $0.isNumber }.hasPrefix(key) }
    }

    func read(app name: String?, limit: Int) throws -> String {
        guard Self.isTrusted else { throw HandsError(message: "not_trusted") }
        let app: NSRunningApplication
        if let name, !name.isEmpty {
            guard let a = find(name) else {
                throw HandsError(message: "\(name) isn't open. Open it with open_app first.")
            }
            app = a
        } else {
            guard let a = NSWorkspace.shared.frontmostApplication else { throw HandsError(message: "No app is in front.") }
            app = a
        }
        lastApp = app
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 1.5)
        let window: AXUIElement? = attr(root, kAXFocusedWindowAttribute) ?? (attr(root, kAXWindowsAttribute) as [AXUIElement]?)?.first
        guard let window else { throw HandsError(message: "\(app.localizedName ?? "The app") has no open window.") }

        elements = [:]
        var lines: [String] = []
        var next = 1
        let focused: AXUIElement? = attr(root, kAXFocusedUIElementAttribute)

        func visit(_ e: AXUIElement, depth: Int) {
            guard lines.count < limit, depth < 40 else { return }
            let role: String = attr(e, kAXRoleAttribute) ?? ""
            let subrole: String? = attr(e, kAXSubroleAttribute)
            let title: String = attr(e, kAXTitleAttribute) ?? ""
            let desc: String = attr(e, kAXDescriptionAttribute) ?? ""
            let help: String = attr(e, kAXHelpAttribute) ?? ""
            let placeholder: String = attr(e, kAXPlaceholderValueAttribute) ?? ""
            let roleDescription: String? = attr(e, kAXRoleDescriptionAttribute)
            let secure = Self.isSecure(role: role, subrole: subrole, roleDescription: roleDescription)
            let value = Self.redacted(Self.stringValue(e), secure: secure)
            let label = [title, desc, placeholder, help].first { !$0.isEmpty } ?? ""
            if Self.interesting(role: role, label: label, value: value) {
                let enabled: Bool = attr(e, kAXEnabledAttribute) ?? true
                let id = next
                next += 1
                elements[id] = e
                var line = "[\(id)] \(Self.friendly(role, secure ? "AXSecureTextField" : subrole))"
                if !label.isEmpty { line += " “\(label)”" }
                if let v = value, !v.isEmpty, v != label { line += " = \(v.prefix(120))" }
                if !enabled { line += " (disabled)" }
                if focused.map({ CFEqual($0, e) }) ?? false { line += " (focused)" }
                lines.append(line)
            }
            // Nothing inside a password field is read.
            guard !secure else { return }
            let children: [AXUIElement] = attr(e, kAXChildrenAttribute) ?? []
            for c in children { visit(c, depth: depth + 1) }
        }
        visit(window, depth: 0)
        let title: String = attr(window, kAXTitleAttribute) ?? ""
        var out = ["App: \(app.localizedName ?? "App")", "Window: \(title.isEmpty ? "(untitled)" : title)"]
        out += lines
        if lines.isEmpty { out.append("(no readable controls; the app may need a moment to open)") }
        return out.joined(separator: "\n")
    }

    func label(of id: Int) -> String {
        guard let e = elements[id] else { return "" }
        let title: String = attr(e, kAXTitleAttribute) ?? ""
        let desc: String = attr(e, kAXDescriptionAttribute) ?? ""
        return title.isEmpty ? desc : title
    }

    /// Where an element is on screen, in points from the top left of the main display (Axe's cursor goes there).
    func frame(of id: Int) -> [String: Double]? {
        guard let e = elements[id] else { return nil }
        var pos: CFTypeRef?
        var size: CFTypeRef?
        guard AXUIElementCopyAttributeValue(e, kAXPositionAttribute as CFString, &pos) == .success,
              AXUIElementCopyAttributeValue(e, kAXSizeAttribute as CFString, &size) == .success,
              let p = pos, let s = size else { return nil }
        var point = CGPoint.zero
        var extent = CGSize.zero
        AXValueGetValue(p as! AXValue, .cgPoint, &point)
        AXValueGetValue(s as! AXValue, .cgSize, &extent)
        return ["x": point.x, "y": point.y, "width": extent.width, "height": extent.height]
    }

    var lastAppName: String { lastApp?.localizedName ?? "" }

    func press(_ id: Int) throws {
        let e = try element(id)
        var names: CFArray?
        AXUIElementCopyActionNames(e, &names)
        let actions = (names as? [String]) ?? []
        let action = actions.contains(kAXPressAction) ? kAXPressAction : actions.contains("AXConfirm") ? "AXConfirm" : kAXPressAction
        guard AXUIElementPerformAction(e, action as CFString) == .success else { throw HandsError(message: "Couldn't press element \(id).") }
    }

    func type(_ text: String, into id: Int?) throws {
        if let id {
            let e = try element(id)
            AXUIElementSetAttributeValue(e, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            if AXUIElementSetAttributeValue(e, kAXValueAttribute as CFString, text as CFTypeRef) == .success { return }
        }
        guard Self.isTrusted else { throw HandsError(message: "not_trusted") }
        Keyboard.type(text, to: try target())
    }

    func press(keys: String) throws {
        guard Self.isTrusted else { throw HandsError(message: "not_trusted") }
        try Keyboard.combo(keys, to: try target())
    }

    /// Keys only ever go to the app last read, never to whatever happens to be in front.
    private func target() throws -> NSRunningApplication {
        guard let app = lastApp, !app.isTerminated else { throw HandsError(message: "Read an app with read_screen first, so the keys go to the right place.") }
        return app
    }

    private func element(_ id: Int) throws -> AXUIElement {
        guard Self.isTrusted else { throw HandsError(message: "not_trusted") }
        guard let e = elements[id] else { throw HandsError(message: "Element \(id) isn't on screen any more. Read the screen again.") }
        return e
    }

    private func attr<T>(_ e: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(e, name as CFString, &value) == .success, let value else { return nil }
        return value as? T
    }

    static func stringValue(_ e: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(e, kAXValueAttribute as CFString, &value) == .success, let value else { return nil }
        if let s = value as? String { return s }
        if let n = value as? NSNumber { return n.stringValue }
        return nil
    }

    static func isSecure(role: String, subrole: String?, roleDescription: String?) -> Bool {
        if subrole == "AXSecureTextField" || role == "AXSecureTextField" { return true }
        guard let d = roleDescription?.lowercased() else { return false }
        return d.contains("secure text") || d.contains("password")
    }

    static func redacted(_ value: String?, secure: Bool) -> String? {
        guard secure else { return value }
        guard let value, !value.isEmpty else { return nil }
        return "(filled in, hidden)"
    }

    static func interesting(role: String, label: String, value: String?) -> Bool {
        let actionable: Set<String> = [
            kAXButtonRole, kAXTextFieldRole, kAXTextAreaRole, kAXCheckBoxRole, kAXRadioButtonRole, kAXPopUpButtonRole,
            kAXMenuButtonRole, kAXComboBoxRole, kAXSliderRole, kAXMenuItemRole, "AXLink", kAXTabGroupRole, "AXSearchField",
            kAXIncrementorRole, kAXDisclosureTriangleRole, kAXCellRole, kAXRowRole,
        ]
        if actionable.contains(role) { return role == kAXRowRole || role == kAXCellRole ? !(label.isEmpty && (value ?? "").isEmpty) : true }
        if role == kAXStaticTextRole { return !((value ?? label).trimmingCharacters(in: .whitespaces).isEmpty) }
        if role == kAXImageRole { return !label.isEmpty }
        return false
    }

    static func friendly(_ role: String, _ subrole: String?) -> String {
        if subrole == "AXSearchField" { return "search field" }
        if subrole == "AXSecureTextField" { return "password field" }
        let map: [String: String] = [
            kAXButtonRole: "button", kAXTextFieldRole: "text field", kAXTextAreaRole: "text area", kAXCheckBoxRole: "checkbox",
            kAXRadioButtonRole: "radio", kAXPopUpButtonRole: "pop-up", kAXMenuButtonRole: "menu button", kAXComboBoxRole: "combo box",
            kAXSliderRole: "slider", kAXMenuItemRole: "menu item", "AXLink": "link", kAXTabGroupRole: "tabs",
            kAXStaticTextRole: "text", kAXImageRole: "image", kAXCellRole: "cell", kAXRowRole: "row",
            kAXDisclosureTriangleRole: "disclosure", kAXIncrementorRole: "stepper",
        ]
        return map[role] ?? role.replacingOccurrences(of: "AX", with: "").lowercased()
    }
}

@MainActor
enum Keyboard {
    static let codes: [String: CGKeyCode] = [
        "return": CGKeyCode(kVK_Return), "enter": CGKeyCode(kVK_Return), "tab": CGKeyCode(kVK_Tab), "space": CGKeyCode(kVK_Space),
        "escape": CGKeyCode(kVK_Escape), "esc": CGKeyCode(kVK_Escape), "delete": CGKeyCode(kVK_Delete),
        "backspace": CGKeyCode(kVK_Delete), "forwarddelete": CGKeyCode(kVK_ForwardDelete), "up": CGKeyCode(kVK_UpArrow),
        "down": CGKeyCode(kVK_DownArrow), "left": CGKeyCode(kVK_LeftArrow), "right": CGKeyCode(kVK_RightArrow),
        "home": CGKeyCode(kVK_Home), "end": CGKeyCode(kVK_End), "pageup": CGKeyCode(kVK_PageUp), "pagedown": CGKeyCode(kVK_PageDown),
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43,
        "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
        "f1": CGKeyCode(kVK_F1), "f2": CGKeyCode(kVK_F2), "f3": CGKeyCode(kVK_F3), "f4": CGKeyCode(kVK_F4), "f5": CGKeyCode(kVK_F5),
    ]

    static func parse(_ keys: String) throws -> (CGKeyCode, CGEventFlags) {
        var flags: CGEventFlags = []
        var key: CGKeyCode?
        for raw in keys.lowercased().split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch raw {
            case "cmd", "command", "⌘": flags.insert(.maskCommand)
            case "shift", "⇧": flags.insert(.maskShift)
            case "opt", "option", "alt", "⌥": flags.insert(.maskAlternate)
            case "ctrl", "control", "⌃": flags.insert(.maskControl)
            default:
                guard let code = codes[raw] else { throw HandsError(message: "I don't know the key combination “\(keys)”.") }
                key = code
            }
        }
        guard let key else { throw HandsError(message: "I don't know the key combination “\(keys)”.") }
        return (key, flags)
    }

    static func combo(_ keys: String, to app: NSRunningApplication) throws {
        let (code, flags) = try parse(keys)
        let src = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
            e?.flags = flags
            post(e, to: app)
        }
    }

    static func type(_ text: String, to app: NSRunningApplication) {
        let src = CGEventSource(stateID: .combinedSessionState)
        var chunk: [Character] = []
        func flush() {
            guard !chunk.isEmpty else { return }
            let units = Array(String(chunk).utf16)
            for down in [true, false] {
                let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
                e?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                post(e, to: app)
            }
            chunk = []
            usleep(8000)
        }
        for ch in text {
            chunk.append(ch)
            if chunk.count == 16 { flush() }
        }
        flush()
    }

    private static func post(_ e: CGEvent?, to app: NSRunningApplication) {
        e?.postToPid(app.processIdentifier)
    }
}

// MARK: - The line protocol

@MainActor
func handle(_ hands: Hands, _ req: [String: Any]) -> [String: Any] {
    let id = req["id"] ?? NSNull()
    let int = { (k: String) -> Int? in (req[k] as? NSNumber)?.intValue }
    do {
        let result: Any
        switch req["cmd"] as? String ?? "" {
        case "trusted": result = Hands.isTrusted
        case "read": result = try hands.read(app: req["app"] as? String, limit: int("limit") ?? 220)
        case "press":
            try hands.press(int("element") ?? -1)
            result = true
        case "type":
            try hands.type(req["text"] as? String ?? "", into: int("element"))
            result = true
        case "keys":
            try hands.press(keys: req["keys"] as? String ?? "")
            result = true
        case "label": result = ["label": hands.label(of: int("element") ?? -1), "app": hands.lastAppName]
        case "lastApp": result = hands.lastAppName
        case "frame": result = hands.frame(of: int("element") ?? -1) ?? NSNull()
        default: throw HandsError(message: "Unknown command.")
        }
        return ["id": id, "ok": true, "result": result]
    } catch let e as HandsError {
        return ["id": id, "ok": false, "error": e.message]
    } catch {
        return ["id": id, "ok": false, "error": "\(error)"]
    }
}

let hands = MainActor.assumeIsolated { Hands() }
setvbuf(stdout, nil, _IOLBF, 0)
Thread.detachNewThread {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let req = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async {
            let reply = handle(hands, req)
            if let out = try? JSONSerialization.data(withJSONObject: reply), let s = String(data: out, encoding: .utf8) {
                print(s)
            }
        }
    }
    // After the replies already queued.
    DispatchQueue.main.async { exit(0) }
}
// A run loop, so NSWorkspace keeps the list of running apps current.
RunLoop.main.run()
