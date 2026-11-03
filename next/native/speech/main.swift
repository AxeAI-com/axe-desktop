// axe-speech: speech to text on the Mac itself for Axe AI's desktop app, through Apple's on-device
// speech model (SpeechAnalyzer, macOS 26 and later). No audio leaves the computer. Speaking needs no
// helper: the window's speechSynthesis already reads with the system's voices, and AVSpeechSynthesizer
// gives a helper signed like ours the same voices and no better ones. One run per job; prints one JSON
// object on stdout:
//   axe-speech status <locale>               -> {"ok":true,"status":"installed","locale":"en_US"}
//   axe-speech prepare <locale>              -> {"ok":true,"status":"installed","locale":"en_US"}
//   axe-speech transcribe <locale> <file>    -> {"ok":true,"text":"…"}
// Status: installed (ready), supported (model not downloaded yet), downloading, unsupported.
// Errors: {"ok":false,"error":"…"}; "unavailable" means this Mac can't (older macOS, no model).

import AVFoundation
import Foundation
import Speech

func reply(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{\"ok\":false,\"error\":\"json\"}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(object["ok"] as? Bool == true ? 0 : 1)
}

func fail(_ message: String) -> Never { reply(["ok": false, "error": message]) }

@available(macOS 26, *)
func statusName(_ s: AssetInventory.Status) -> String {
    switch s {
    case .installed: return "installed"
    case .downloading: return "downloading"
    case .supported: return "supported"
    default: return "unsupported"
    }
}

@available(macOS 26, *)
func transcriber(for wanted: String) async -> SpeechTranscriber? {
    guard SpeechTranscriber.isAvailable,
          let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: wanted)) else { return nil }
    return SpeechTranscriber(locale: locale, preset: .transcription)
}

@available(macOS 26, *)
func run(_ args: [String]) async -> Never {
    guard args.count >= 2 else { fail("usage: axe-speech status|prepare|transcribe <locale> [file]") }
    let cmd = args[0]
    guard let module = await transcriber(for: args[1]) else { reply(["ok": true, "status": "unsupported"]) }
    let locale = module.selectedLocales.first?.identifier ?? args[1]

    switch cmd {
    case "status":
        reply(["ok": true, "status": statusName(await AssetInventory.status(forModules: [module])), "locale": locale])

    case "prepare":
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                try await request.downloadAndInstall()
            }
            reply(["ok": true, "status": statusName(await AssetInventory.status(forModules: [module])), "locale": locale])
        } catch {
            fail("Couldn't download the speech model: \(error.localizedDescription)")
        }

    case "transcribe":
        guard args.count >= 3 else { fail("usage: axe-speech transcribe <locale> <file>") }
        // Never downloads here: the app prepares the model in the background and uses axeai.com meanwhile.
        guard await AssetInventory.status(forModules: [module]) == .installed else { fail("not_installed") }
        do {
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[2]))
            let analyzer = SpeechAnalyzer(modules: [module])
            let collect = Task {
                var text = ""
                for try await result in module.results where result.isFinal {
                    text += String(result.text.characters)
                }
                return text
            }
            if let end = try await analyzer.analyzeSequence(from: file) {
                try await analyzer.finalizeAndFinish(through: end)
            } else {
                await analyzer.cancelAndFinishNow()
            }
            let text = try await collect.value
            reply(["ok": true, "text": text.trimmingCharacters(in: .whitespacesAndNewlines)])
        } catch {
            fail("Couldn't write that down: \(error.localizedDescription)")
        }

    default:
        fail("unknown command \(cmd)")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
if #available(macOS 26, *) {
    await run(args)
} else {
    // Older macOS: the app uses axeai.com instead.
    if args.first == "status" { reply(["ok": true, "status": "unsupported"]) }
    fail("unavailable")
}
