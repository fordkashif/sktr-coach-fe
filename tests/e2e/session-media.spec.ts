import { expect, test, type Page } from "@playwright/test"
import { seedMockSession } from "./helpers/session"

/** A photo drawn in the page, larger than the 1600 pixel limit so the resize has something to do. */
async function makePhoto(page: Page, width = 2400, height = 1800) {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext("2d")!
      context.fillStyle = "#2152ff"
      context.fillRect(0, 0, w, h)
      context.fillStyle = "#ffc93c"
      context.fillRect(w / 4, h / 4, w / 2, h / 2)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let text = ""
      for (const byte of bytes) text += String.fromCharCode(byte)
      return btoa(text)
    },
    [width, height],
  )
  return { name: "rep.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") }
}

/** A clip of about a second, recorded in the page from a moving canvas. */
async function makeVideo(page: Page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 160
    canvas.height = 120
    const context = canvas.getContext("2d")!
    let frame = 0
    const draw = window.setInterval(() => {
      context.fillStyle = frame % 2 ? "#0c9d61" : "#2152ff"
      context.fillRect(0, 0, 160, 120)
      context.fillStyle = "#ffffff"
      context.fillRect((frame * 8) % 160, 40, 30, 30)
      frame += 1
    }, 50)
    const recorder = new MediaRecorder(canvas.captureStream(20), { mimeType: "video/webm" })
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => chunks.push(event.data)
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
    recorder.start()
    await new Promise((resolve) => window.setTimeout(resolve, 1300))
    recorder.stop()
    await stopped
    window.clearInterval(draw)
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())
    let text = ""
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  })
  return { name: "rep.webm", mimeType: "video/webm", buffer: Buffer.from(base64, "base64") }
}

function savedMedia(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((entry) => entry.startsWith("pacelab:session-media:v1"))
    return JSON.parse((key && window.localStorage.getItem(key)) || "[]") as Array<{ kind: string; width: number; height: number; rowId: string | null; contentType: string; durationSeconds: number | null }>
  })
}

test.describe("photos and videos on a session log (mock mode)", () => {
  test("an athlete adds a photo to an exercise and a video to the session, captions and removes", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    await expect(page.getByRole("heading", { level: 1, name: "Acceleration and weights" })).toBeVisible()

    // A photo on one exercise. It uploads while the log stays usable.
    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.locator('input[type="file"]').setInputFiles(await makePhoto(page))
    await squat.getByLabel("Back squat, set 1, reps").fill("5")
    const squatPhoto = squat.locator('[data-media-item="photo"]')
    await expect(squatPhoto).toBeVisible()
    await expect(squatPhoto).toContainText("Photo")
    await expect(squat.locator("[data-media-upload]")).toHaveCount(0)

    // It was made smaller in the browser: 2400 x 1800 became 1600 x 1200, as a JPEG.
    const afterPhoto = await savedMedia(page)
    expect(afterPhoto).toHaveLength(1)
    expect(afterPhoto[0]).toMatchObject({ kind: "photo", width: 1600, height: 1200, contentType: "image/jpeg" })
    expect(afterPhoto[0].rowId).not.toBeNull()

    // A caption.
    await squatPhoto.getByRole("button").click()
    const viewer = page.getByRole("dialog")
    await expect(viewer.locator("img")).toBeVisible()
    await viewer.getByLabel(/Caption/).fill("Third rep, from the side")
    await viewer.getByRole("button", { name: "Save caption" }).click()
    await viewer.getByRole("button", { name: "Close" }).click()
    await expect(squatPhoto).toContainText("Third rep, from the side")

    // A short video for the whole session.
    const section = page.locator('[data-session-media="log"]')
    await expect(section.getByText("1 of 6")).toBeVisible()
    await section.locator('input[type="file"]').setInputFiles(await makeVideo(page))
    const sessionVideo = section.locator('[data-media-item="video"]')
    await expect(sessionVideo).toBeVisible()
    await expect(sessionVideo).toContainText(/Video, \d s/)
    await expect(section.getByText("2 of 6")).toBeVisible()
    // The photo belongs to its exercise, so it is not repeated in the session's own list.
    await expect(section.locator('[data-media-item="photo"]')).toHaveCount(0)
    const afterVideo = await savedMedia(page)
    expect(afterVideo[1].kind).toBe("video")
    expect(afterVideo[1].durationSeconds).toBeGreaterThan(0.5)
    expect(afterVideo[1].durationSeconds).toBeLessThan(5)

    // The player: the browser's own controls, in place, never starting by itself.
    await sessionVideo.getByRole("button").click()
    const player = page.getByRole("dialog").locator("video")
    await expect(player).toBeVisible()
    await expect(player).toHaveAttribute("controls", "")
    await expect(player).toHaveAttribute("playsinline", "")
    expect(await player.getAttribute("autoplay")).toBeNull()
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()

    // Still there after a reload, and on the finished session's read view with the exercise named.
    await page.reload()
    await expect(page.locator('[data-exercise="Back squat"] [data-media-item="photo"]')).toContainText("Third rep, from the side")
    await page.getByRole("button", { name: "Finish session" }).click()
    await expect(page.getByText("Nice work. That is logged.")).toBeVisible()
    await page.goto("/athlete/log")
    const read = page.locator('[data-session-media="read"]')
    await expect(read.locator('[data-media-item="photo"]')).toContainText("Photo, Back squat")
    await expect(read.locator('[data-media-item="video"]')).toBeVisible()

    // Removing an item asks first, then it is gone.
    await read.locator('[data-media-item="photo"]').getByRole("button").click()
    await page.getByRole("dialog").getByRole("button", { name: "Remove photo" }).click()
    await expect(page.getByText("Remove this photo? It is deleted for you and for your coach.")).toBeVisible()
    await page.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Remove photo" }).click()
    await expect(read.locator('[data-media-item="photo"]')).toHaveCount(0)
    expect(await savedMedia(page)).toHaveLength(1)
  })

  test("offline, an item waits on the phone and goes when the connection is back", async ({ page, context }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    const section = page.locator('[data-session-media="log"]')
    await expect(section).toBeVisible()
    const photo = await makePhoto(page, 800, 600)

    await context.setOffline(true)
    await section.locator('input[type="file"]').setInputFiles(photo)
    const waiting = section.locator('[data-media-upload="waiting"]')
    await expect(waiting).toContainText("Waiting to upload when you are back online")
    // The log is still usable while it waits.
    await page.getByLabel("Back squat, set 1, reps").fill("5")
    await expect(page.getByLabel("Back squat, set 1, reps")).toHaveValue("5")
    expect(await savedMedia(page)).toHaveLength(0)

    // A second one, cancelled before it is sent, never arrives.
    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.locator('input[type="file"]').setInputFiles(photo)
    await expect(squat.locator('[data-media-upload="waiting"]')).toBeVisible()
    await squat.getByRole("button", { name: "Cancel Photo" }).click()
    await expect(squat.locator("[data-media-upload]")).toHaveCount(0)

    await context.setOffline(false)
    await expect(section.locator('[data-media-item="photo"]')).toBeVisible()
    await expect(section.locator("[data-media-upload]")).toHaveCount(0)
    expect(await savedMedia(page)).toHaveLength(1)
  })

  test("refusals are in plain words: the wrong kind of file, and the seventh item", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    const section = page.locator('[data-session-media="log"]')
    await section.locator('input[type="file"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") })
    await expect(section.getByRole("alert")).toContainText("Choose a photo or a video. Other files cannot be added.")
    await section.getByRole("button", { name: "OK" }).click()

    // Something that says it is a video and is not: the length cannot be read, so it is refused before any upload.
    await section.locator('input[type="file"]').setInputFiles({ name: "broken.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video at all") })
    await expect(section.getByRole("alert")).toContainText("could not read that video")
    await section.getByRole("button", { name: "OK" }).click()

    const photo = await makePhoto(page, 400, 300)
    for (let count = 1; count <= 6; count += 1) {
      await section.locator('input[type="file"]').setInputFiles(photo)
      await expect(section.locator('[data-media-item="photo"]')).toHaveCount(count)
    }
    await expect(section.getByText("6 of 6")).toBeVisible()
    await expect(section.getByText("That is the most for one session. Remove one to add another.")).toBeVisible()
    // The buttons on the exercises are off too.
    await expect(page.locator('[data-exercise="Back squat"]').getByRole("button", { name: "Add photo or video" })).toBeDisabled()
    expect(await savedMedia(page)).toHaveLength(6)
  })

  test("the coach watches, comments, and the athlete sees the comment", async ({ page }) => {
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    const squat = page.locator('[data-exercise="Back squat"]')
    await squat.locator('input[type="file"]').setInputFiles(await makeVideo(page))
    await expect(squat.locator('[data-media-item="video"]')).toBeVisible()
    await squat.getByLabel("Back squat, set 1, reps").fill("5")
    await squat.getByLabel("Back squat, set 1, load in kilograms").fill("120")
    await expect(page.locator('[data-sync="saved"]').first()).toBeVisible()
    await page.getByRole("button", { name: "Finish session" }).click()
    await expect(page.getByText("Nice work. That is logged.")).toBeVisible()

    await seedMockSession(page, { role: "coach", coachTeamId: "t1" })
    await page.goto("/coach/athletes/a1")
    const media = page.locator("[data-session-media-coach]").first()
    await expect(media).toContainText(/1 video from/)
    const row = media.locator('[data-media-item="video"]')
    await expect(row).toContainText("Back squat")
    await expect(row).toContainText("Open to watch and comment")
    await row.getByRole("button").click()
    const viewer = page.getByRole("dialog")
    const player = viewer.locator("video")
    await expect(player).toHaveAttribute("controls", "")
    expect(await player.getAttribute("autoplay")).toBeNull()
    // A coach comments. They cannot caption or remove the athlete's video.
    await expect(viewer.getByLabel(/Caption/)).toHaveCount(0)
    await expect(viewer.getByRole("button", { name: /Remove/ })).toHaveCount(0)
    await viewer.getByLabel(/Your comment/).fill("Chest up out of the hole. Good depth.")
    await viewer.getByRole("button", { name: "Save comment" }).click()
    await viewer.getByRole("button", { name: "Close" }).click()
    await expect(row).toContainText("Comment: Chest up out of the hole. Good depth.")

    // Logging for the athlete is the one place a coach adds a photo or video for them.
    await page.goto("/coach/athletes/a1/log")
    await expect(page.locator("[data-logging-for]")).toBeVisible()
    const section = page.locator('[data-session-media="log"]')
    await section.locator('input[type="file"]').setInputFiles(await makePhoto(page, 600, 400))
    await expect(section.locator('[data-media-item="photo"]')).toBeVisible()
    // The athlete's own video is there, and is not the coach's to remove. The photo the coach added is.
    const coachSquat = page.locator('[data-exercise="Back squat"]')
    await coachSquat.locator('[data-media-item="video"]').getByRole("button").click()
    await expect(page.getByRole("dialog").locator("video")).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("button", { name: /Remove/ })).toHaveCount(0)
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()
    await section.locator('[data-media-item="photo"]').getByRole("button").click()
    await expect(page.getByRole("dialog").getByRole("button", { name: "Remove photo" })).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()

    // Back as the athlete: the comment sits under the video.
    await seedMockSession(page, { role: "athlete" })
    await page.goto("/athlete/log")
    const read = page.locator('[data-session-media="read"]')
    await expect(read.locator('[data-media-item="video"]')).toContainText("Your coach: Chest up out of the hole. Good depth.")
    await expect(read.locator('[data-media-item="photo"]')).toBeVisible()
  })

  test("the privacy page says who sees photos and videos and when they are deleted", async ({ page }) => {
    await page.goto("/privacy")
    await expect(page.getByText(/Photos and short videos an athlete adds to a session log are seen by that athlete/)).toBeVisible()
    await expect(page.getByText(/A photo or video on a session log is deleted when the athlete removes it/)).toBeVisible()
  })
})
