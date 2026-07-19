using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Wih
{
    /// <summary>
    /// Speech-to-text via OpenAI transcription, using the player's BYOK key
    /// (ApiKeyStore). Record with StartRecording(), then StopAndTranscribe(cb).
    /// The key is read from ApiKeyStore only, sent in the Authorization header to
    /// api.openai.com only, and NEVER logged. Audio is 16 kHz mono WAV in-memory.
    /// </summary>
    public class SpeechInput : MonoBehaviour
    {
        public string model = "whisper-1"; // or "gpt-4o-mini-transcribe"
        public int maxSeconds = 20;
        public int sampleRate = 16000;

        public bool IsRecording { get; private set; }

        private AudioClip _clip;
        private string _device;

        public bool HasMic => Microphone.devices != null && Microphone.devices.Length > 0;

        public void StartRecording()
        {
            if (IsRecording || !HasMic) return;
            _device = Microphone.devices[0];
            _clip = Microphone.Start(_device, false, maxSeconds, sampleRate);
            IsRecording = true;
        }

        /// <summary>Stop, upload to OpenAI, and call back with the transcript (or null on failure).</summary>
        public void StopAndTranscribe(Action<string> onResult)
        {
            if (!IsRecording) { onResult?.Invoke(null); return; }
            int pos = Microphone.GetPosition(_device);
            Microphone.End(_device);
            IsRecording = false;

            if (_clip == null || pos <= 0) { onResult?.Invoke(null); return; }
            // Voice uses the OpenAI slot ONLY — never the Anthropic agent key.
            if (!ApiKeyStore.HasVoiceKey) { onResult?.Invoke("[no OpenAI voice key — paste one in the key panel]"); return; }

            var samples = new float[pos * _clip.channels];
            _clip.GetData(samples, 0);
            byte[] wav = EncodeWav(samples, _clip.channels, _clip.frequency);
            StartCoroutine(Transcribe(wav, onResult));
        }

        public void Cancel()
        {
            if (IsRecording) { Microphone.End(_device); IsRecording = false; }
        }

        private IEnumerator Transcribe(byte[] wav, Action<string> onResult)
        {
            var form = new List<IMultipartFormSection>
            {
                new MultipartFormFileSection("file", wav, "speech.wav", "audio/wav"),
                new MultipartFormDataSection("model", model),
                new MultipartFormDataSection("response_format", "json"),
            };
            using var req = UnityWebRequest.Post("https://api.openai.com/v1/audio/transcriptions", form);
            req.SetRequestHeader("Authorization", "Bearer " + ApiKeyStore.VoiceKeyRaw()); // OpenAI voice key only leaves via this header
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                // Do NOT log the request (it carries the key). Surface a generic status only.
                Debug.LogWarning($"[Wih] transcription failed: HTTP {(int)req.responseCode}");
                onResult?.Invoke(null);
                yield break;
            }
            string text = null;
            try { text = (string)JObject.Parse(req.downloadHandler.text)["text"]; } catch { }
            onResult?.Invoke(text);
        }

        // ── minimal 16-bit PCM WAV encoder ──
        private static byte[] EncodeWav(float[] samples, int channels, int hz)
        {
            using var ms = new MemoryStream();
            using var w = new BinaryWriter(ms);
            int bytesPerSample = 2;
            int dataLen = samples.Length * bytesPerSample;
            w.Write(new[] { 'R', 'I', 'F', 'F' });
            w.Write(36 + dataLen);
            w.Write(new[] { 'W', 'A', 'V', 'E' });
            w.Write(new[] { 'f', 'm', 't', ' ' });
            w.Write(16);
            w.Write((short)1);              // PCM
            w.Write((short)channels);
            w.Write(hz);
            w.Write(hz * channels * bytesPerSample);
            w.Write((short)(channels * bytesPerSample));
            w.Write((short)(bytesPerSample * 8));
            w.Write(new[] { 'd', 'a', 't', 'a' });
            w.Write(dataLen);
            foreach (var s in samples)
                w.Write((short)(Mathf.Clamp(s, -1f, 1f) * short.MaxValue));
            w.Flush();
            return ms.ToArray();
        }
    }
}
