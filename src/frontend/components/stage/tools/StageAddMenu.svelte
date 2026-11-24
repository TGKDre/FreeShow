<script lang="ts">
    import { timers } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { addStageItem } from "../stage"

    export let isLocked = false

    type Entry = { id: string; label: string; icon: string; add: () => void }
    type Group = { label: string; entries: Entry[] }

    $: firstTimerId = Object.values($timers).find((timer) => timer.type !== "counter")?.id || ""

    $: groups = buildGroups()

    function buildGroups(): Group[] {
        const groups: Group[] = [
            {
                label: "stage.element_current_slide",
                entries: [
                    { id: "current_slide", label: "stage.element_current_slide", icon: "text", add: () => addStageItem("slide_text", { slideOffset: 0 }) },
                    { id: "next_slide", label: "stage.element_next_slide", icon: "text", add: () => addStageItem("slide_text", { slideOffset: 1 }) }
                ]
            },
            {
                label: "stage.element_timer",
                entries: [
                    { id: "timer", label: "stage.element_timer", icon: "timer", add: () => addStageItem("timer", firstTimerId ? { timer: { id: firstTimerId } } : {}) },
                    { id: "clock", label: "stage.element_clock", icon: "clock", add: () => addStageItem("clock") }
                ]
            },
            {
                label: "stage.element_program_feed",
                entries: [{ id: "current_output", label: "stage.element_program_feed", icon: "screen", add: () => addStageItem("current_output") }]
            },
            {
                label: "stage.element_message",
                entries: [{ id: "message", label: "stage.element_message", icon: "text", add: () => addStageItem("text") }]
            },
            {
                label: "stage.element_media",
                entries: [
                    { id: "media", label: "stage.element_media", icon: "image", add: () => addStageItem("media") },
                    { id: "camera", label: "stage.element_camera", icon: "camera", add: () => addStageItem("camera") }
                ]
            },
            {
                label: "stage.element_more",
                entries: [
                    { id: "notes", label: "stage.element_notes", icon: "notes", add: () => addStageItem("slide_notes", { slideOffset: 0 }) },
                    { id: "web", label: "stage.element_web", icon: "web", add: () => addStageItem("web") },
                    { id: "qr_code", label: "stage.element_qr_code", icon: "qr_code", add: () => addStageItem("qr_code") },
                    { id: "slide_progress", label: "stage.element_slide_progress", icon: "percentage", add: () => addStageItem("slide_tracker") },
                    { id: "metronome", label: "stage.element_metronome", icon: "metronome", add: () => addStageItem("metronome") },
                    { id: "visualizer", label: "stage.element_visualizer", icon: "visualizer", add: () => addStageItem("visualizer") }
                ]
            }
        ]

        return groups
    }
</script>

{#if !isLocked}
    <div class="addMenu">
        {#each groups as group (group.label)}
            <div class="group">
                <p class="groupLabel">{translateText(group.label)}</p>
                <div class="entries">
                    {#each group.entries as entry (entry.id)}
                        <button class="entry" on:click={entry.add} title={translateText(entry.label)}>
                            <Icon id={entry.icon} white />
                            <span>{translateText(entry.label)}</span>
                        </button>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
{/if}

<style>
    .addMenu {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        margin: 6px 0;
        border: 1px solid var(--primary-lighter);
        border-radius: 10px;
        background-color: var(--primary-darkest);
    }

    .groupLabel {
        margin: 0 0 4px 2px;
        font-size: 0.68em;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.45;
    }

    .entries {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .entry {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid var(--primary-lighter);
        border-radius: 20px;
        background-color: var(--primary-dark);
        color: inherit;
        font-size: 0.8em;
        cursor: pointer;
        white-space: nowrap;
    }

    .entry:hover {
        border-color: var(--secondary);
        color: var(--secondary);
    }

    .entry:hover :global(svg) {
        color: var(--secondary);
    }
</style>
