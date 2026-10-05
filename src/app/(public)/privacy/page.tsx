import { Link } from "react-router-dom"
import { LegalList, LegalPage, LegalSection, LegalText } from "@/components/legal/legal-page"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

const support = (
  <a href={SUPPORT_MAILTO} className="sk-link">
    {SUPPORT_EMAIL}
  </a>
)

/**
 * Privacy notice, written to follow Jamaica's Data Protection Act, 2020. It describes what the app does today.
 * Still a draft until a lawyer has read it (see LEGAL_REVIEWED).
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lede="What SKTR Coach stores about you, who can see it, and your rights under Jamaica's Data Protection Act, 2020.">
      <LegalSection title="The short version">
        <LegalList
          items={[
            "SKTR Coach is a training app for track and field clubs. A club signs up, then invites its coaches and athletes.",
            "We store what you and your club put in: accounts, teams, training plans, session logs, results, wellness check-ins, pain and injury reports, and messages.",
            "Health information about an athlete is seen by that athlete, the coaches of their current team and their club's admins. Nobody else in the app.",
            "Club admins can read the messages between coaches and athletes in their club. This is on purpose, to keep athletes safe.",
            "We do not sell your information and we do not show adverts or use advertising trackers.",
            "Health information is only recorded with consent, and for an athlete under 18 that consent comes from a parent or guardian.",
            <>To see, correct or delete your information, email {support}. We answer within 30 days.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="Who is responsible">
        <LegalText>
          SKTR Coach is made and run by SKTR Labs, a software studio in Kingston, Jamaica. This notice follows Jamaica's Data Protection Act, 2020 (the Act), which uses two terms that matter here.
        </LegalText>
        <LegalList
          items={[
            "Your club is the data controller for what it records about its members: who is on its teams, and the training, results, health information and messages of its athletes. The club decides what is recorded and why.",
            "SKTR Labs is the data processor for that information. We store it and show it on the club's instructions, and we do not use it for anything else.",
            "SKTR Labs is the data controller for the information needed to run the service itself: your sign-in details, the requests clubs send us to join, a club's package and billing contact, and security records.",
          ]}
        />
        <LegalText>
          If you have a question about what your club has recorded, your club admin is usually the quickest person to ask. You can always write to us as well, at {support}. That address also reaches the person at SKTR Labs who is responsible for data protection.
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

      <LegalSection title="Health information">
        <LegalText>
          Wellness check-ins, pain and injury reports, medical notes and allergies are health information. The Act treats this as sensitive personal data, which needs stronger protection and the person's consent in writing.
        </LegalText>
        <LegalList
          items={[
            "Health information is recorded only so that an athlete and their coaches can plan training safely.",
            "An athlete enters most of it themselves and chooses what to enter. No health field has to be filled in to use the app.",
            "The club must have the written consent of the athlete, or of a parent or guardian for an athlete under 18, before its coaches record health information about that athlete.",
            "Consent can be withdrawn at any time by telling the club or emailing us. We then stop recording it and remove what is stored, unless the law requires it to be kept.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Children and young athletes">
        <LegalText>
          Many athletes who use SKTR Coach are under 18. Under the Act a parent or guardian gives consent for a child and can use the child's rights for them. An athlete joins only through their club, by an invite or a team join code from a coach. Before an athlete under 18 uses the app, the club must have the consent of a parent or guardian, including consent to record health information.
        </LegalText>
        <LegalText>
          Messages between an adult coach and an athlete are limited to coaches of the athlete's own team, are text only, cannot be deleted by either person, and can always be read by the club's admins. If you are a parent or guardian and want to see, correct or remove what is stored about your child, or to withdraw your consent, ask the club or email {support}.
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

      <LegalSection title="Why we are allowed to use it">
        <LegalText>The Act lets personal information be used only for a lawful reason. These are ours:</LegalText>
        <LegalList
          items={[
            "To provide the service your club has signed up for and that you have joined (a contract).",
            "Your consent, or a parent's or guardian's, for health information and for an athlete under 18. Consent can be withdrawn.",
            "Our legitimate interest in keeping the service secure, stopping spam and abuse, and fixing faults, where that does not override your rights.",
            "To meet a legal duty, if the law requires us to keep or hand over something.",
          ]}
        />
        <LegalText>
          We collect only what the app needs, use it only for the purposes on this page, and do not make decisions about you by automated means alone. Readiness and adherence figures are shown to you and your coach as a guide. A person decides what to do with them.
        </LegalText>
      </LegalSection>

      <LegalSection title="Other companies that help us run the service">
        <LegalList
          items={[
            "Our hosting providers (Supabase for the database, sign-in and file storage, and Vercel for the website) store and deliver the app's information on our behalf.",
            "Resend delivers our emails. It receives the recipient's email address and the content of each email.",
            "Vercel Web Analytics counts visits to pages so we can see how the app is used. It does not use cookies and does not follow you across other websites.",
          ]}
        />
        <LegalText>
          These providers act only on our instructions and store information on servers outside Jamaica. The Act allows personal information to leave Jamaica only where it stays properly protected. We send it abroad because the service cannot run without these providers, we use providers that commit in their contracts to keep it secure and confidential, and it is encrypted on the way and where it is stored. Apart from these providers, we share information only if the law requires it.
        </LegalText>
      </LegalSection>

      <LegalSection title="Keeping it safe">
        <LegalList
          items={[
            "Each club's information is kept apart from every other club's, and the database itself checks every request against the person's role, club and team.",
            "Passwords are stored in scrambled form. Connections to the app are encrypted.",
            "Health information, private details and messages are open only to the people listed under Who can see what.",
            "Administrative actions in a club are recorded so that misuse can be found.",
          ]}
        />
        <LegalText>
          If there is a security breach that affects personal information, we will report it to the Information Commissioner within 72 hours of learning of it, as the Act requires, and promptly tell the clubs and people affected what happened and what we are doing about it.
        </LegalText>
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
        <LegalText>We keep personal information only for as long as it is needed for the purposes on this page.</LegalText>
        <LegalList
          items={[
            "A club's information is kept for as long as the club uses SKTR Coach. If a club's access is paused, its information is kept so it can be restored.",
            "When a club tells us it has stopped using SKTR Coach, we delete its information within 90 days.",
            "If an athlete leaves a team, their history stays in their own account. A club admin can delete an athlete's information, and anyone can ask us to delete their account.",
            "A request from a club to join that we decline is deleted within 12 months.",
            "The records kept to stop spam on the request form are kept for about a day.",
            "We may keep something longer where the law requires it, or where a club needs a record to protect an athlete. We will tell you if that applies to a request you make.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Your rights">
        <LegalText>The Act gives you these rights over your personal information. A parent or guardian can use them for a child.</LegalText>
        <LegalList
          items={[
            "To be told whether we hold information about you, to get a copy of it, and to know what it is used for and who it is shared with.",
            "To have anything that is wrong or out of date corrected, and to have information deleted that should no longer be kept.",
            "To withdraw a consent you have given.",
            "To ask us to stop or limit a use of your information that is causing you, or is likely to cause you, damage or distress.",
            "Not to receive marketing. We do not send any.",
            "Not to have decisions made about you by automated means alone. We do not make any.",
          ]}
        />
        <LegalText>
          You can change your name, photo, password and notification choices yourself in the app under Your account. Athletes can edit their own private details and mark a pain report as resolved.
        </LegalText>
        <LegalText>
          For anything else, email {support} from the address you sign in with. We do not charge for this. We will answer within 30 days. We may need to confirm who you are, and where your club is the data controller we will work with the club to deal with your request.
        </LegalText>
        <LegalText>
          If you are not satisfied with our answer, you can complain to the Office of the Information Commissioner in Jamaica, which oversees the Act.
        </LegalText>
      </LegalSection>

      <LegalSection title="Changes to this page">
        <LegalText>
          When we change this page we will update the effective date at the top, and tell club admins about changes that matter. See also our <Link to="/terms" className="sk-link">terms</Link>.
        </LegalText>
      </LegalSection>
    </LegalPage>
  )
}
