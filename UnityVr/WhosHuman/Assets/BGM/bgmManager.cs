using UnityEngine;

[RequireComponent(typeof(AudioSource))]
public class BGMLoopPlayer : MonoBehaviour
{
    [SerializeField] private AudioClip bgm;
    [SerializeField] private bool playOnStart = true;

    private AudioSource audioSource;

    private void Awake()
    {
        audioSource = GetComponent<AudioSource>();

        audioSource.clip = bgm;
        audioSource.loop = true;
        audioSource.playOnAwake = false;
    }

    private void Start()
    {
        if (playOnStart && bgm != null)
        {
            audioSource.Play();
        }
    }

    public void Play()
    {
        if (!audioSource.isPlaying)
            audioSource.Play();
    }

    public void Stop()
    {
        audioSource.Stop();
    }

    public void Pause()
    {
        audioSource.Pause();
    }

    public void Resume()
    {
        audioSource.UnPause();
    }
}