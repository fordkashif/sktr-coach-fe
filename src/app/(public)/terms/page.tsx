import { Link } from "react-router-dom"
import { LegalList, LegalPage, LegalSection, LegalText } from "@/components/legal/legal-page"
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support"

const support = (
  <a href={SUPPORT_MAILTO} className="sk-link">
    {SUPPORT_EMAIL}
  </a>
)

/** Terms of use. A plain-language draft that describes how the app works today. Not yet reviewed by a lawyer. */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" lede="The rules for using SKTR Coach, in plain words.">
      <LegalSection title="What SKTR Coach is">
        <LegalText>
          SKTR Coach is an app for track and field clubs, schools and coaching groups. Coaches build training plans, run test weeks and see how their athletes are doing. Athletes log sessions, results and how they feel. It is made and run by SKTR Labs, a software studio in Kingston, Jamaica.
        </LegalText>
        <LegalText>By using SKTR Coach, or by sending a request for your club to join, you agree to these terms.</LegalText>
      </LegalSection>

      <LegalSection title="Accounts">
        <LegalList
          items={[
            "Clubs join by request. We review each request and may decline one.",
            "Coaches and athletes join through their club, by an invite or a team join code.",
            "Use your own name and an email address you control. Keep your password to yourself.",
            "Tell your club admin or us straight away if you think someone else has used your account.",
          ]}
        />
      </LegalSection>

      <LegalSection title="What clubs are responsible for">
        <LegalList
          items={[
            "Inviting only people who belong to the club, and removing access when someone leaves.",
            "Having the agreement of a parent or guardian before an athlete under 18 uses the app, where that is needed.",
            "Deciding what its coaches record about athletes, including health information, and making sure the club is allowed to record it.",
            "Looking after athletes: club admins can read the messages between coaches and athletes in their club and should act on reports.",
            "Keeping its own details and billing contact up to date.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Using the app fairly">
        <LegalText>Please do not:</LegalText>
        <LegalList
          items={[
            "Use the app to harass, threaten or harm anyone, or send anything unlawful or sexual.",
            "Message an athlete about anything other than their training, health for training, competitions and club matters.",
            "Enter information about a person that you have no right to share.",
            "Try to get into another club's information, or get around the limits of your role.",
            "Copy the app, overload it, or use scripts to fill in its forms.",
          ]}
        />
        <LegalText>We may pause or end access for a person or a club that breaks these rules.</LegalText>
      </LegalSection>

      <LegalSection title="Not medical advice">
        <LegalText>
          Wellness check-ins, readiness and pain reports are there to help a coach and an athlete talk to each other. They are not a diagnosis and SKTR Coach does not give medical advice. If you are hurt or unwell, see a doctor or physiotherapist. In an emergency, call your local emergency number.
        </LegalText>
      </LegalSection>

      <LegalSection title="Your content">
        <LegalText>
          The plans, results, notes and messages you put in stay yours (or your club's). You give us permission to store and show them as the app needs in order to work. How we handle personal information is set out on the <Link to="/privacy" className="sk-link">privacy page</Link>.
        </LegalText>
      </LegalSection>

      <LegalSection title="Packages and payment">
        <LegalText>
          A club chooses a package when it joins, and each package has limits on coaches and athletes. The app itself does not take payments. Any price and how it is paid are agreed between the club and SKTR Labs separately.
        </LegalText>
      </LegalSection>

      <LegalSection title="Pausing and ending access">
        <LegalList
          items={[
            "A club admin can turn off a member's access to the club.",
            "We can pause or end a club's access, for example if these terms are broken or an agreed payment is not made.",
            "A club can stop using SKTR Coach at any time by emailing us.",
            "When access is paused or ended the club's information is kept so it can be restored. To have it deleted, email us.",
          ]}
        />
      </LegalSection>

      <LegalSection title="The service">
        <LegalText>
          We work to keep SKTR Coach available and correct, but we cannot promise it will never be down or never contain a mistake. Coaches remain responsible for the training they set, and athletes for how they train. We may change or remove features as the app develops.
        </LegalText>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <LegalText>When we change these terms we will update the effective date at the top, and tell club admins about changes that matter.</LegalText>
      </LegalSection>

      <LegalSection title="Contact">
        <LegalText>Questions about these terms: {support}.</LegalText>
      </LegalSection>
    </LegalPage>
  )
}
