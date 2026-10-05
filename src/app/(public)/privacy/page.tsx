import { Link } from "react-router-dom"
import { LegalList, LegalPage, LegalSection, LegalText } from "@/components/legal/legal-page"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

const support = (
  <a href={SUPPORT_MAILTO} className="sk-link">
    {SUPPORT_EMAIL}
  </a>
)

/** Privacy notice. A plain-language draft that describes what the app does today. Not yet reviewed by a lawyer. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lede="What SKTR Coach stores about you, who can see it, and how to ask us to show, fix or delete it.">
      <LegalSection title="The short version">
        <LegalList
          items={[
            "SKTR Coach is a training app for track and field clubs. A club signs up, then invites its coaches and athletes.",
            "We store what you and your club put in: accounts, teams, training plans, session logs, results, wellness check-ins, pain and injury reports, and messages.",
            "Health information about an athlete is seen by that athlete, the coaches of their current team and their club's admins. Nobody else in the app.",
            "Club admins can read the messages between coaches and athletes in their club. This is on purpose, to keep athletes safe.",
            "We do not sell your information and we do not show adverts or use advertising trackers.",
            <>To see, correct or delete your information, email {support}.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Who is responsible">
        <LegalText>
          SKTR Coach is made and run by SKTR Labs, a software studio in Kingston, Jamaica. Your club decides who is on its teams and what its coaches record about its athletes. We run the service that stores it. If you have a question about what your club has recorded, your club admin is usually the quickest person to ask. You can always write to us as well.
        </LegalText>
      </LegalSection>

      <LegalSection title="What we store">
        <LegalText>Everyone with an account:</LegalText>
        <LegalList
          items={[
            "Your name, email address and password (the password is stored in scrambled form; we cannot read it).",
            "A profile photo, if you add one.",
            "Your role (athlete, coach or club admin), your club and your teams.",
            "Your notification choices and the notifications sent to you.",
          ]}
        />
        <LegalText>Athletes:</LegalText>
        <LegalList
          items={[
            "Training: the plan assigned to you, the sessions you log, test week results, competition entries and results, and personal bests.",
            "Wellness check-ins: sleep, soreness, fatigue, stress and mood, and any note you add.",
            "Pain and injury reports: where it hurts, how bad it is, when it started, whether it stops you training, and your note.",
            "Private details, if you or your club add them: date of birth, preferred name, pronouns, height, weight, an emergency contact, medical notes and allergies, a bib or registration number, and your school or club affiliation.",
            "For athletes under 18, the name, phone number and email address of a parent or guardian may be stored.",
          ]}
        />
        <LegalText>Coaches and club admins:</LegalText>
        <LegalList
          items={[
            "The plans, test weeks, competitions, rosters and announcements you create.",
            "A record of administrative actions in the club (for example an invite sent, a member's access turned off, a file exported). These records do not contain health information or message text.",
            "For the club: its name, logo, profile, package, and a billing contact name and email.",
          ]}
        />
        <LegalText>People who ask for access for their club:</LegalText>
        <LegalList
          items={[
            "What you type into the request form: your name, work email, job title, the club's name, type, website and country, and the expected numbers of coaches and athletes.",
            "To stop spam, a scrambled (hashed) form of your email and network address is kept for a short time, about a day. We do not keep the address itself.",
          ]}
        />
        <LegalText>Messages:</LegalText>
        <LegalList
          items={[
            "Announcements from coaches and club admins, and who has read them.",
            "Direct messages between one coach and one athlete on that coach's team. Text only. Messages cannot be edited or deleted by the people in the conversation.",
            "Reports of a message made to the club's admins, and any message a club admin has hidden.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Who can see what">
        <LegalList
          items={[
            "You can see your own information.",
            "Coaches see the training, results, wellness check-ins, pain reports and private details of athletes on teams they are assigned to. When an athlete leaves a team, that team's coaches stop seeing them.",
            "Club admins see the same for every athlete in their own club, and manage the club's coaches, teams and invites.",
            "Club admins can read (but not write in) every direct message thread between a coach and an athlete in their club. A person in a conversation can report a message to the club admins, and a club admin can hide a message.",
            "Other athletes, coaches of other teams and other clubs cannot see your health information, private details or messages.",
            "A coach's email address is shown to their athletes only if the coach switches that on.",
            "Emails about a new message or a pain report say that there is something to read. They do not contain the message text or any health detail.",
          ]}
        />
        <LegalText>
          SKTR Labs staff use separate admin screens to approve clubs and manage packages. Those screens do not show health information, private athlete details or messages. Because we operate the database, a small number of SKTR Labs staff can technically reach stored information. We do so only when it is needed to fix a problem, keep the service secure or meet a legal duty.
        </LegalText>
      </LegalSection>

      <LegalSection title="Children and young athletes">
        <LegalText>
          Many athletes who use SKTR Coach are under 18. An athlete joins only through their club, by an invite or a team join code from a coach. The club is responsible for having the agreement of a parent or guardian where that is needed, and for deciding what its coaches record about young athletes.
        </LegalText>
        <LegalText>
          Messages between an adult coach and an athlete are limited to coaches of the athlete's own team, are text only, cannot be deleted by either person, and can always be read by the club's admins. If you are a parent or guardian and want to see, correct or remove what is stored about your child, ask the club or email {support}.
        </LegalText>
      </LegalSection>

      <LegalSection title="What we use it for">
        <LegalList
          items={[
            "To run the app: showing athletes their training, showing coaches who is ready to train, and keeping records for the club.",
            "To send the emails and in-app notifications the service needs (invites, password resets, and the notifications you have left switched on).",
            "To review requests from clubs and set clubs up.",
            "To keep the service secure, find faults and stop abuse.",
          ]}
        />
        <LegalText>We do not use your information for advertising, and we do not sell it or give it to anyone to market to you.</LegalText>
      </LegalSection>

      <LegalSection title="Other companies that help us run the service">
        <LegalList
          items={[
            "Our hosting providers (Supabase for the database, sign-in and file storage, and Vercel for the website) store and deliver the app's information on our behalf.",
            "Resend delivers our emails. It receives the recipient's email address and the content of each email.",
            "Vercel Web Analytics counts visits to pages so we can see how the app is used. It does not use cookies and does not follow you across other websites.",
          ]}
        />
        <LegalText>These providers may store information on servers outside Jamaica.</LegalText>
      </LegalSection>

      <LegalSection title="Cookies and storage on your device">
        <LegalText>
          We use a small number of cookies and browser storage entries to keep you signed in and to remember your role, club and team. If you install the app on your phone, session logs can be kept on the device while you are offline and are sent when you are back online. We do not use advertising cookies.
        </LegalText>
      </LegalSection>

      <LegalSection title="Payments">
        <LegalText>The app does not take card payments and does not store card or bank account numbers.</LegalText>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <LegalText>
          We keep a club's information for as long as the club uses SKTR Coach. If a club's access is paused or ended, its information is kept, not deleted, so it can be restored. If an athlete leaves a team, their history stays in their own account. To have information deleted, see the next section.
        </LegalText>
      </LegalSection>

      <LegalSection title="Your choices">
        <LegalList
          items={[
            "You can change your name, photo, password and notification choices in the app under Your account.",
            "Athletes can edit their own private details and mark a pain report as resolved.",
            <>To get a copy of your information, have something corrected, or have your account and its information deleted, email {support} from the address you sign in with. We will reply and may need to check with your club first.</>,
            "Some records may need to be kept for a time even after a request, for example messages that a club needs for safeguarding. We will tell you if that applies.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Changes to this page">
        <LegalText>
          When we change this page we will update the effective date at the top, and tell club admins about changes that matter. See also our <Link to="/terms" className="sk-link">terms</Link>.
        </LegalText>
      </LegalSection>
    </LegalPage>
  )
}
