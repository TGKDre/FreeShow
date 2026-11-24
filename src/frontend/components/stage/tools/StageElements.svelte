<script lang="ts">
    import type { StageItem } from "../../../../types/Stage"
    import { activeStage, stageShows } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import { getAccess } from "../../../utils/profile"
    import { itemBoxes } from "../../edit/values/boxes"
    import { getSortedStageItems, moveStageInvertedItems } from "../../edit/scripts/itemHelpers"
    import { deleteAction } from "../../helpers/clipboard"
    import DragItemWrapper from "../../helpers/DragItemWrapper.svelte"
    import Icon from "../../helpers/Icon.svelte"
    import { createDragReorder } from "../../helpers/dragReorder"
    import { getStageElementDetail, getStageElementName, updateStageShow } from "../stage"
    import StageAddMenu from "./StageAddMenu.svelte"

    const profile = getAccess("stage")
    $: readOnly = profile.global === "read" || profile[$activeStage.id || ""] === "read" || profile[$activeStage.id || ""] === "none"

    $: stageId = $activeStage.id || ""
    $: items = $stageShows[stageId]?.items || {}

    let showAddMenu = false

    const dragReorder = createDragReorder((fromIndices, toIndex) => {
        const reordered = dragReorder.getReorderedList(invertedItemList, fromIndices, toIndex)
        moveStageInvertedItems(reordered)
    })
    const { dragOverIndex, draggedIndices } = dragReorder

    $: allItems = stageId ? getSortedStageItems(stageId, $stageShows) : []
    // paint order is back to front, the operator reads front to back
    $: invertedItemList = Array.isArray(allItems) ? allItems.map((_, i) => allItems[allItems.length - 1 - i]) : []
    $: selectedIndices = ($activeStage.items || []).map((itemId) => invertedItemList.findIndex((it) => it.id === itemId)).filter((idx) => idx >= 0)
    $: displayList = dragReorder.getReorderedList(invertedItemList, $draggedIndices, $dragOverIndex)
    $: isPlaceholderActive = $dragOverIndex !== null

    function isVisible(item: StageItem) {
        return item.enabled !== false
    }

    function toggleVisible(id: string) {
        const item = items[id]
        if (!item || readOnly) return

        stageShows.update((a) => {
            if (!a[stageId]?.items?.[id]) return a
            a[stageId].items[id].enabled = !isVisible(item)
            a[stageId].modified = Date.now()
            return a
        })
        updateStageShow()
    }

    function removeElement(id: string) {
        if (readOnly) return

        activeStage.update((a) => ({ ...a, items: [id] }))
        deleteAction({ id: "stage_item", data: { id: stageId } } as any)
    }

    function selectItem(id: string, e: any) {
        activeStage.update((ae) => {
            if (e?.detail?.ctrl || e?.ctrlKey) {
                if (ae.items.includes(id)) ae.items.splice(ae.items.indexOf(id), 1)
                else ae.items.push(id)
            } else if (!ae.items.includes(id)) ae.items = [id]
            else ae.items = []
            return ae
        })
    }
</script>

<div class="main border stageElements">
    <div class="head">
        <div class="title">
            <Icon id="style" white size={0.8} />
            <p>{translateText("stage.elements")}</p>
            <span class="count">{invertedItemList.length}</span>
        </div>

        {#if !readOnly}
            <button class="addButton" class:open={showAddMenu} on:click={() => (showAddMenu = !showAddMenu)} title={translateText("stage.add_element")}>
                <Icon id={showAddMenu ? "close" : "add"} white size={0.9} />
                <span>{translateText("stage.add_element")}</span>
            </button>
        {/if}
    </div>

    {#if showAddMenu}
        <StageAddMenu isLocked={readOnly} />
    {/if}

    {#if displayList.length}
        <div class="items">
            {#each displayList as currentItem, i (currentItem.id)}
                {@const id = currentItem.id}
                {@const type = currentItem.type || "text"}
                {@const isPlaceholder = isPlaceholderActive && $draggedIndices.some((dIdx) => currentItem === invertedItemList[dIdx])}
                {@const detail = getStageElementDetail(currentItem)}

                <DragItemWrapper index={i} controller={dragReorder} {isPlaceholder} {selectedIndices}>
                    <div class="row" class:active={$activeStage.items.includes(id)} class:hidden={!isVisible(currentItem)}>
                        {#if displayList.length > 1}
                            <span class="dragHandle" title={translateText("edit.arrange_items")}>
                                <Icon id="drag" white size={0.7} />
                            </span>
                        {/if}

                        <button class="select" on:click={(e) => selectItem(id, e)} title={translateText("stage.selected")}>
                            <Icon id={type === "icon" ? id || "" : itemBoxes[type]?.icon || "text"} custom={type === "icon"} size={0.8} />
                            <span class="names">
                                <span class="name">{getStageElementName(currentItem)}</span>
                                {#if detail}<span class="detail">{detail}</span>{/if}
                            </span>
                        </button>

                        {#if !readOnly}
                            <button class="iconButton" class:dim={!isVisible(currentItem)} on:click={() => toggleVisible(id)} title={translateText(isVisible(currentItem) ? "stage.hide_element" : "stage.show_element")}>
                                <Icon id={isVisible(currentItem) ? "eye" : "hide"} white size={0.75} />
                            </button>
                            <button class="iconButton" on:click={() => removeElement(id)} title={translateText("stage.delete_element")}>
                                <Icon id="delete" white size={0.75} />
                            </button>
                        {/if}
                    </div>
                </DragItemWrapper>
            {/each}
        </div>
    {:else}
        <p class="empty">{translateText("stage.no_elements")}</p>
    {/if}
</div>

<style>
    .main {
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        max-height: 45%;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--primary-lighter);
        background-color: var(--primary-darker);
        position: sticky;
        top: 0;
        z-index: 2;
    }

    .title {
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .title p {
        font-weight: 600;
        font-size: 0.82rem;
    }

    .count {
        font-size: 0.7rem;
        opacity: 0.45;
        font-variant-numeric: tabular-nums;
    }

    .addButton {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border: 1px solid var(--secondary);
        border-radius: 16px;
        background: transparent;
        color: var(--secondary);
        font-size: 0.75rem;
        cursor: pointer;
        white-space: nowrap;
    }

    .addButton.open {
        background-color: var(--secondary);
        color: black;
    }

    .addButton.open :global(svg) {
        color: black;
    }

    .items {
        display: flex;
        flex-direction: column;
        padding: 4px;
        gap: 2px;
    }

    .row {
        display: flex;
        align-items: center;
        gap: 2px;
        border-radius: 7px;
        border-left: 3px solid transparent;
    }

    .row:hover {
        background-color: var(--primary-dark);
    }

    .row.active {
        background-color: var(--primary-dark);
        border-left-color: var(--secondary);
    }

    .row.hidden {
        opacity: 0.45;
    }

    .dragHandle {
        display: flex;
        align-items: center;
        padding: 0 2px;
        opacity: 0.45;
        cursor: grab;
    }

    .select {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
        padding: 6px 4px;
        border: none;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }

    .names {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.25;
    }

    .name {
        font-size: 0.85em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .detail {
        font-size: 0.72em;
        opacity: 0.5;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .iconButton {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border: none;
        background: transparent;
        cursor: pointer;
        opacity: 0.55;
    }

    .iconButton:hover {
        opacity: 1;
    }

    .iconButton.dim {
        opacity: 0.3;
    }

    .empty {
        padding: 12px;
        font-size: 0.8em;
        opacity: 0.5;
        text-align: center;
    }
</style>
