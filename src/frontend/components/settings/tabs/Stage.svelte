<script lang="ts">
    import type { StageLayout } from "../../../../types/Stage"
    import { activePage, activeStage, outputs, stageShows } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import { getAccess } from "../../../utils/profile"
    import { keysToID, sortByName } from "../../helpers/array"
    import { history } from "../../helpers/history"
    import { getStageOutputId } from "../../helpers/output"
    import Icon from "../../helpers/Icon.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import StageSlide from "../../stage/StageSlide.svelte"

    const profile = getAccess("stage")
    $: readOnly = profile.global === "read"

    $: layouts = sortByName(keysToID($stageShows)).filter((layout) => profile[layout.id] !== "none")
    $: currentOutputId = getStageOutputId($outputs)
    $: currentOutput = $outputs[currentOutputId] || {}

    function elementCount(layout: StageLayout) {
        return Object.keys(layout.items || {}).length
    }

    function layoutResolution(layout: StageLayout) {
        const resolution = layout.settings?.resolution
        if (!resolution?.width) return ""
        return `${resolution.width} × ${resolution.height}`
    }

    function openEditor(id?: string) {
        const layoutId = id || $activeStage.id || layouts[0]?.id
        if (!layoutId) return

        if ($activeStage.id !== layoutId) activeStage.set({ id: layoutId, items: [] })
        activePage.set("stage")
    }

    function newLayout() {
        history({ id: "UPDATE", location: { page: "stage", id: "stage" } })
        openEditor()
    }
</script>

<div class="page">
    <p class="intro">{translateText("stage.layouts_hint")}</p>

    <div class="actions">
        <MaterialButton on:click={() => openEditor()} disabled={!layouts.length} title="stage.open_editor">
            <Icon id="stage" white />
            <span>{translateText("stage.open_editor")}</span>
        </MaterialButton>

        <MaterialButton on:click={newLayout} disabled={readOnly} title="stage.new_layout">
            <Icon id="add" white />
            <span>{translateText("stage.new_layout")}</span>
        </MaterialButton>
    </div>

    <div class="status">
        <Icon id={currentOutput.stageOutput ? "check" : "info"} size={0.75} />
        {#if currentOutput.stageOutput}
            <span>{currentOutput.name || ""} · {translateText("stage.stage_layout")}: {$stageShows[currentOutput.stageOutput]?.name || ""}</span>
        {:else}
            <span>{translateText("stage.output_none")}</span>
        {/if}
    </div>

    {#if layouts.length}
        <div class="layouts">
            {#each layouts as layout (layout.id)}
                <div class="layout" class:active={$activeStage.id === layout.id}>
                    <div class="thumb">
                        <StageSlide id={layout.id} {layout} list columns={1} active={$activeStage.id === layout.id} selectable={false} on:click={() => ($activeStage.id === layout.id ? null : activeStage.set({ id: layout.id, items: [] }))} />
                    </div>

                    <div class="info">
                        <p class="name">{layout.name}</p>
                        <p class="meta">
                            <span>{elementCount(layout)} {translateText("stage.elements").toLowerCase()}</span>
                            {#if layoutResolution(layout)}<span>· {layoutResolution(layout)}</span>{/if}
                        </p>
                    </div>

                    <MaterialButton on:click={() => openEditor(layout.id)} title="stage.open_editor">
                        <Icon id="edit" white size={0.8} />
                    </MaterialButton>
                </div>
            {/each}
        </div>
    {:else}
        <p class="empty">{translateText("stage.no_layouts")}</p>
    {/if}
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 15px;
        max-width: 700px;
    }

    .intro {
        opacity: 0.7;
        font-size: 0.9em;
        line-height: 1.45;
    }

    .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82em;
        opacity: 0.65;
        padding: 8px 10px;
        border: 1px solid var(--primary-lighter);
        border-radius: 8px;
    }

    .layouts {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .layout {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px;
        border: 1px solid var(--primary-lighter);
        border-radius: 9px;
    }

    .layout.active {
        border-color: var(--secondary);
    }

    .thumb {
        width: 150px;
        flex: 0 0 auto;
    }

    .thumb :global(.main) {
        padding: 0;
    }

    .info {
        flex: 1;
        min-width: 0;
    }

    .name {
        font-weight: 600;
        font-size: 0.9em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .meta {
        font-size: 0.75em;
        opacity: 0.5;
        display: flex;
        gap: 5px;
        align-items: center;
    }

    .empty {
        opacity: 0.5;
        font-size: 0.85em;
    }
</style>
