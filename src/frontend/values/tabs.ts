import type { SettingsTabs } from "../../types/Tabs"

// Ordered the way the team already knows it from ProPresenter: general first, appearance together,
// then what is on screen, then media and devices, then files, with profiles last.
export const settingsGroups: { name: string; tabs: SettingsTabs[] }[] = [
    { name: "General", tabs: ["general", "other"] },
    { name: "Appearance", tabs: ["theme", "styles"] },
    { name: "Screens", tabs: ["display_settings", "stage"] },
    { name: "Media and audio", tabs: ["audio"] },
    { name: "Scripture and AI", tabs: ["ai"] },
    { name: "Devices and network", tabs: ["connection"] },
    { name: "Files and backups", tabs: ["files"] },
    { name: "Profiles", tabs: ["profiles"] }
]

export const settingsTabs: SettingsTabs[] = settingsGroups.flatMap((group) => group.tabs)

export const drawerTabs = {
    shows: { name: "tabs.shows", icon: "shows", title: "tabs.shows_info" },
    media: { name: "tabs.media", icon: "media", title: "" },
    audio: { name: "tabs.audio", icon: "audio", title: "" },
    overlays: { name: "tabs.overlays", icon: "overlays", title: "" },
    templates: { name: "tabs.templates", icon: "templates", title: "" },

    scripture: { name: "tabs.scripture", icon: "scripture", title: "" },
    calendar: { name: "tabs.calendar", icon: "calendar", title: "" },
    sermon: { name: "Sermon", icon: "book", title: "Sermon notes and word study" },

    functions: { name: "tabs.functions", icon: "functions", title: "" }
}

// export const drawerTabs = {
//     shows: { name: "tabs.shows", icon: "shows", style: "background-color: #4b0b0b !important;color: #ff3a3a;" },
//     media: { name: "tabs.media", icon: "media", style: "background-color: #0b3a4b !important;color: #3affff;" },
//     audio: { name: "tabs.audio", icon: "audio", style: "background-color: #3a4b0b !important;color: #afff3a;" },
//     overlays: { name: "tabs.overlays", icon: "overlays", style: "background-color: #4b0b3a !important;color: #ff3aff;" },
//     templates: { name: "tabs.templates", icon: "templates", style: "background-color: #3a0b4b !important;color: #af3aff;" },

//     scripture: { name: "tabs.scripture", icon: "scripture", style: "background-color: #4b4b0b !important;color: #ffff3a;" },
//     calendar: { name: "tabs.calendar", icon: "calendar", style: "background-color: #0b4b3a !important;color: #3affaf;" },

//     functions: { name: "tabs.functions", icon: "functions", style: "background-color: #2b2b2b !important;color: #aaaaaa;" }
// }
