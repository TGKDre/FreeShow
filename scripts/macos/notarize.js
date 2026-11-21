// From https://github.com/simonw/til/blob/main/electron/sign-notarize-electron-macos.md
// Based on https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/

const { notarize } = require("@electron/notarize")

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context
    if (electronPlatformName !== "darwin") return

    // Grace City builds are unsigned, so there is nothing to notarize unless the full Apple
    // credential set is present. Without this, @electron/notarize fails the whole macOS job.
    const credentials = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
    const missing = credentials.filter((id) => !process.env[id])
    if (missing.length) {
        console.log(`Skipping notarization, missing ${missing.join(", ")}`)
        return
    }

    const appName = context.packager.appInfo.productFilename

    return await notarize({
        appBundleId: "app.freeshow",
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
    })
}
