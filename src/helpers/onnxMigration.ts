// [20261002_T9_MigrationUx] Ticket #420 (spec #412 user stories 3/5): the
// old-user migration state for the ONNX engine switch. Upgrading users keep
// their torch generation, but the new engine reads the separate onnx-int8
// generation root — so the first launch after the upgrade must explicitly
// tell them a model re-download (~660MB) is required before the new engine
// can transcribe, offer resume-able download / defer, and keep serving the
// torch generation as the fallback meanwhile (one version cycle, deleted by
// the T12 cleanup ticket). This module computes THAT state; it never talks
// to the network and never mutates the model dirs. Pure Node (no electron
// imports) so the S2 seam can unit-test it with temp dirs.
import fs from "fs";
import path from "path";
import {
  loadModelPin,
  readinessProblems,
  type ModelPin,
} from "./modelDownloader";
// [20261002_T9_MigrationUx] The status shape is the shared IPC contract type
// (src/types/ipc.ts) — single source of truth, re-exported for main-process
// consumers (funasrManager / modelHandlers).
import type { OnnxMigrationStatus } from "../types/ipc";

export type { OnnxMigrationStatus };

/** Pin model ROLES that must be ready before the ONNX engine can serve.
 * Mirrors the authoritative Python startup gate (funasr_server.py
 * _find_missing_required_models): ASR + VAD required, punc optional,
 * speaker (diarize) optional. Parity with the pin's role keys is locked by
 * tests/unit/onnx-model-pin.test.ts. */
export const REQUIRED_PIN_MODEL_ROLES: readonly string[] = ["asr", "vad"];

export interface OnnxMigrationDeps {
  pinPath: string;
  /** Root holding <pin-model-name>/ subdirectories (modelManager's
   * getOnnxModelsRoot). */
  modelsRoot: string;
  /** Torch-generation probe (production: modelManager.isTorchGenerationPresent).
   * Omitted in plain-Node tests → treated as a fresh install (no fallback). */
  torchFallbackPresent?: () => boolean;
}

/** Compute the migration state from disk. Read-only; never throws. */
export function getOnnxMigrationStatus(
  deps: OnnxMigrationDeps,
): OnnxMigrationStatus {
  const torchFallbackAvailable = deps.torchFallbackPresent?.() ?? false;

  let pin: ModelPin;
  try {
    pin = loadModelPin(deps.pinPath);
  } catch (error) {
    // Invalid/missing pin: report the error, suppress the prompt. The app
    // keeps running on whatever generation it can (torch fallback or the
    // legacy download flow); the caller logs the packaging bug.
    return {
      needed: false,
      onnx_ready: false,
      torch_fallback_available: torchFallbackAvailable,
      total_bytes: 0,
      remaining_bytes: 0,
      error: (error as Error).message,
    };
  }

  const models = Object.values(pin.models);
  const requiredReady: boolean[] = [];
  let totalBytes = 0;
  let remainingBytes = 0;

  for (const model of models) {
    const modelDir = path.join(deps.modelsRoot, model.name);
    for (const file of model.files) {
      totalBytes += file.size_bytes;
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(path.join(modelDir, file.path));
      } catch {
        stat = null;
      }
      // A missing OR size-mismatched file will be re-fetched by the v2
      // downloader (corrupt files are removed before retry), so both count
      // toward the honest "remaining" volume the dialog can show.
      if (!stat || !stat.isFile() || stat.size !== file.size_bytes) {
        remainingBytes += file.size_bytes;
      }
    }
  }

  // Readiness is judged per ROLE key (asr/vad/...), not per dir name: the
  // required set is the server gate's policy, the dir names live in the pin.
  for (const role of REQUIRED_PIN_MODEL_ROLES) {
    const model = pin.models[role];
    if (!model) {
      requiredReady.push(false);
      continue;
    }
    requiredReady.push(
      readinessProblems(path.join(deps.modelsRoot, model.name), model)
        .length === 0,
    );
  }
  const onnxReady = requiredReady.every(Boolean);

  return {
    needed: !onnxReady,
    onnx_ready: onnxReady,
    torch_fallback_available: torchFallbackAvailable,
    total_bytes: totalBytes,
    remaining_bytes: remainingBytes,
  };
}
