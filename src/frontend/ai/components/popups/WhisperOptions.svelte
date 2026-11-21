<script lang="ts">
    import { onMount } from "svelte"
    import type { EngineStatus } from "../../../../types/ai/Ai"
    import { Main } from "../../../../types/IPC/Main"
    import MaterialButton from "../../../components/inputs/MaterialButton.svelte"
    import Loader from "../../../components/main/Loader.svelte"
    import Tip from "../../../components/main/Tip.svelte"
    import { requestMain } from "../../../IPC/main"
    import { mediaDownloads } from "../../../stores"
    import { newToast } from "../../../utils/common"

    const engine = "whisper"

    let status: EngineStatus | null = null
    async function getStatus() {
        const result = await requestMain(Main.AI_GET_STATUS, { engineId: engine })
        status = result?.[engine] || null
        if (status?.error && status.error !== "The local model is missing") newToast(status.error)
    }

    onMount(() => {
        getStatus()
    })

    // the four files report under one stable "whisper" key
    $: modelDownload = $mediaDownloads.get(engine)
    $: isModelDownloading = modelDownloadStarted || modelDownload?.status === "downloading"

    function getPercent(download: { progress: number; total: number } | undefined) {
        if (!download?.total) return ""
        return ` ${Math.min(100, Math.floor((download.progress / download.total) * 100))}%`
    }

    let modelDownloadStarted = false
    async function downloadModel() {
        if (isModelDownloading) return
        modelDownloadStarted = true

        await requestMain(Main.AI_SETUP, { action: "download", engineId: engine }, undefined, 60 * 60 * 1000)
        modelDownloadStarted = false

        getStatus()
    }
</script>

{#if !status}
    <div style="display: flex;justify-content: center;padding: 10px;">
        <Loader />
    </div>
{:else if status.unsupported}
    <Tip type="warning" value={status.error} />
{:else if !status.ready}
    <Tip type="info" value="About 1 GB. Sharper on long sermons and names than the streaming engine, but words only appear after the speaker pauses." />
    <MaterialButton variant="outlined" icon="download" disabled={isModelDownloading} style="flex: 1;" on:click={downloadModel}>
        Download Whisper{getPercent(modelDownload)}
    </MaterialButton>
{:else}
    <Tip type="success" value="Whisper is ready." />
{/if}
