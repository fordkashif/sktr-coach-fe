"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Megaphone } from "@phosphor-icons/react"
import { Button, Choices, Field, LinkButton, Notice, Screen, ScreenHeader, Section, Select, Textarea } from "@/components/sk"
import { getStaffTeams, type StaffTeam } from "@/lib/data/competition/staff-roster"
import { announcementHref, messagesHomeHref } from "@/lib/data/messages/links"
import { postAnnouncement } from "@/lib/data/messages/messages-data"
import { MESSAGE_MAX_LENGTH, type AnnouncementAudience } from "@/lib/data/messages/types"

/**
 * Write an announcement. A coach posts to the team they have selected (`team`). A club admin
 * (no `team`) chooses the whole club, all coaches or one team.
 */
export function AnnouncementCompose({ role, team }: { role: "coach" | "club-admin"; team: { id: string; name: string } | null }) {
  const navigate = useNavigate()
  const choosesAudience = role === "club-admin"
  const [audience, setAudience] = useState<AnnouncementAudience>(choosesAudience ? "club" : "team")
  const [teamId, setTeamId] = useState(team?.id ?? "")
  const [teams, setTeams] = useState<StaffTeam[] | null>(null)
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const left = MESSAGE_MAX_LENGTH - body.length
  const backTo = messagesHomeHref(role, "announcements")

  useEffect(() => {
    if (!choosesAudience) return
    let cancelled = false
    void getStaffTeams().then((result) => {
      if (!cancelled) setTeams(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [choosesAudience])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (audience === "team" && !(choosesAudience ? teamId : team?.id)) {
      setError(choosesAudience ? "Choose the team this is for." : "Choose a team first, then post.")
      return
    }
    setPosting(true)
    const result = await postAnnouncement({ audience, teamId: audience === "team" ? (choosesAudience ? teamId : team?.id) : null, body })
    setPosting(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    navigate(announcementHref(role, result.data.announcementId), { replace: true, state: { posted: true } })
  }

  const who = audience === "club" ? "everyone in the club" : audience === "coaches" ? "every coach in the club" : choosesAudience ? "the athletes and coaches of that team" : `the athletes and coaches of ${team?.name ?? "your team"}`

  return (
    <Screen width="narrow">
      <ScreenHeader
        back={{ to: backTo, label: "Announcements" }}
        title="New announcement"
        lede={choosesAudience ? "One message to many people. They read it; they cannot reply to it." : `One message to everyone on ${team?.name ?? "your team"}. They read it; they cannot reply to it.`}
      />
      <Section aria-label="Announcement">
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)} noValidate>
          {choosesAudience ? (
            <>
              <Choices
                label="Who is it for"
                columns={3}
                value={audience}
                onChange={setAudience}
                options={[
                  { value: "club", label: "Whole club" },
                  { value: "coaches", label: "All coaches" },
                  { value: "team", label: "One team" },
                ]}
              />
              {audience === "team" ? (
                <Field label="Team">
                  <Select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    <option value="">{teams === null ? "Loading teams..." : "Choose a team"}</option>
                    {(teams ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}
          <Field
            label="What do you want to say"
            hint={left <= 100 ? `${left < 0 ? `${-left} over the limit` : `${left} characters left`}` : `Goes to ${who}, in the app and by email. Athletes with no login do not get it.`}
            error={left < 0 ? `Keep it to ${MESSAGE_MAX_LENGTH} characters. You are ${-left} over.` : undefined}
          >
            <Textarea value={body} rows={5} placeholder="Training moved to 5pm on Thursday. Same track, bring spikes." onChange={(event) => setBody(event.target.value)} />
          </Field>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={posting || !body.trim() || left < 0}>
              <Megaphone className="size-[18px]" weight="bold" aria-hidden />
              {posting ? "Posting..." : "Post announcement"}
            </Button>
            <LinkButton to={backTo} variant="quiet">
              Cancel
            </LinkButton>
          </div>
        </form>
      </Section>
    </Screen>
  )
}
