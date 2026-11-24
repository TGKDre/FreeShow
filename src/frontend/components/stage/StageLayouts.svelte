<script lang="ts">
    import { onDestroy } from "svelte"
    import type { StageLayout } from "../../../types/Stage"
    import { activeStage, labelsDisabled, outputs, stageShows } from "../../stores"
    import { getAccess } from "../../utils/profile"
    import { translateText } from "../../utils/language"
    import { keysToID, sortByName } from "../helpers/array"
    import { history } from "../helpers/history"
    import T from "../helpers/T.svelte"
    import FloatingInputs from "../input/FloatingInputs.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import Autoscroll from "../system/Autoscroll.svelte"
    import Center from "../system/Center.svelte"
    import SkeletonStageSlide from "./SkeletonStageSlide.svelte"
    import StageSlide from "./StageSlide.svelte"

    function addSlide() {
        history({ id: "UPDATE", location: { page: "stage", id: "stage" } })
    }

    const profile = getAccess("stage")
    const readOnly = profile.global === "read"

    $: sortedStageSlides = sortByName(keysToID($stageShows)).filter((a) => profile[a.id] !== "none")

    function select(id: string, e: any) {
        if (e?.ctrlKey || e?.metaKey || document.activeElement?.closest?.(".edit")) return
        activeStage.update((as) => {
            as.id = id
            return as
        })
    }

    function elementCount(layout: StageLayout) {
        return Object.keys(layout.items || {}).length
    }

    function layoutResolution(layout: StageLayout) {
        const resolution = layout.settings?.resolution
        if (!resolution?.width) return ""
        return `${resolution.width} × ${resolution.height}`
    }

    // lazy loader
    let lazyLoader = 0
    let timeout: NodeJS.Timeout | null = null
    let loaded = false

    onDestroy(() => {
        if (timeout) clearTimeout(timeout)
    })

    $: if (!loaded && sortedStageSlides?.length) {
        if (lazyLoader >= sortedStageSlides.length) {
            loaded = true
        } else {
            if (timeout) clearTimeout(timeout)
            timeout = setTimeout(
                () => {
                    const batch = lazyLoader === 0 ? 2 : Math.min(16, lazyLoader * 2)
                    lazyLoader += batch
                },
                lazyLoader === 0 ? 80 : 40
            )
        }
    }

    $: if ($activeStage.id === null && Object.keys($stageShows).length) setActiveStage()
    function setActiveStage() {
        let activeStageOutput = Object.values($outputs).find((a) => a.enabled && a.stageOutput)?.stageOutput
        let firstStageLayout = activeStageOutput || sortedStageSlides[0]?.id
        activeStage.set({ id: firstStageLayout, items: [] })
    }

    function keydown(e: KeyboardEvent) {
        if (e.target?.closest?.(".edit") || e.ctrlKey || e.metaKey) return
        if ($activeStage.items.length) return

        // CHANGE STAGE LAYOUT

        let nextTab = -1
        let currentTabIndex = sortedStageSlides.findIndex((a) => a.id === $activeStage.id)

        if (e.key === "ArrowDown") {
            nextTab = Math.min(sortedStageSlides.length - 1, currentTabIndex + 1)
        } else if (e.key === "ArrowUp") {
            nextTab = Math.max(0, currentTabIndex - 1)
        }

        if (nextTab < 0 || !sortedStageSlides[nextTab]) return
        activeStage.set({ id: sortedStageSlides[nextTab].id, items: [] })
    }

    // Auto scroll
    let scrollElem: HTMLElement | undefined
    let offset = -1
    $: if ($activeStage.id) {
        setTimeout(() => {
            if (!scrollElem) return
            const index = Math.max(
                0,
                [...(scrollElem.querySelector(".list")?.children || [])].findIndex((a) => a?.classList.contains("active"))
            )
            offset = ((scrollElem.querySelector(".list")?.children?.[index] as HTMLElement)?.offsetTop || 5) - 80
        }, 10)
    }
</script>

<svelte:window on:keydown={keydown} />

<div class="main">
    <div class="head">
        <p class="title">{translateText("stage.layouts")}</p>
        <span class="count">{sortedStageSlides.length}</span>
    </div>

    {#if sortedStageSlides.length}
        <Autoscroll {offset} bind:scrollElem timeout={150} smoothTimeout={0}>
            <div class="list">
                {#each sortedStageSlides as show, i (show.id)}
                    <div class="row" class:active={$activeStage.id === show.id}>
                        {#if loaded || i < lazyLoader}
                            <StageSlide id={show.id} layout={show} list columns={1} active={$activeStage.id === show.id} on:click={(e) => select(show.id, e)} />
                        {:else}
                            <SkeletonStageSlide layout={show} active={$activeStage.id === show.id} on:click={(e) => select(show.id, e)} />
                        {/if}

                        <p class="meta">
                            <span>{elementCount(show)} {translateText("stage.elements").toLowerCase()}</span>
                            {#if layoutResolution(show)}<span>· {layoutResolution(show)}</span>{/if}
                        </p>
                    </div>
                {/each}

                <div class="padding" style="height: 60px;width: 1px;"></div>
            </div>
        </Autoscroll>
    {:else}
        <Center faded>
            <T id="stage.no_layouts" />
        </Center>
    {/if}

    <FloatingInputs onlyOne>
        <MaterialButton disabled={readOnly} icon="add" title="show.new_layout" on:click={addSlide}>
            {#if !$labelsDisabled}<T id="show.new_layout" />{/if}
        </MaterialButton>
    </FloatingInputs>
</div>

<style>
    .main {
        flex: 1;
        display: flex;
        justify-content: space-between;
        flex-direction: column;
        overflow: auto;
        background-color: var(--primary-darker);
    }

    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px 6px;
        border-bottom: 1px solid var(--primary-lighter);
        flex: 0 0 auto;
    }

    .title {
        font-size: 0.85em;
        font-weight: 600;
        opacity: 0.9;
    }

    .count {
        font-size: 0.75em;
        opacity: 0.5;
        font-variant-numeric: tabular-nums;
    }

    .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px;
        width: 100%;
    }

    .row {
        padding: 3px;
        border-radius: 8px;
        border-left: 3px solid transparent;
    }

    .row.active {
        background-color: var(--primary-dark);
        border-left-color: var(--secondary);
    }

    .row :global(.main) {
        padding: 0;
    }

    .meta {
        display: flex;
        align-items: center;
        gap: 5px;
        margin: 2px 2px 0 6px;
        font-size: 0.72em;
        opacity: 0.5;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
