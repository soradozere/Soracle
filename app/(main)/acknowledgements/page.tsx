import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Acknowledgements — JK2 Capture the Flag",
  description:
    "The projects and people this site is built on: TomArrow's JK2 Watcher bots, playja.pro, JK2MV, OpenJK, pdewilde's openjk-wasm, and GL4ES.",
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#66fcf1] underline-offset-4 hover:underline"
    >
      {children}
    </a>
  )
}

// Sam's own words, verbatim -- the links are the only editorial addition.
export default function AcknowledgementsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
        <h2 className="text-2xl font-bold text-[#66fcf1] mb-6">Acknowledgements</h2>

        <div className="space-y-5 leading-relaxed text-[#c5c6c7]">
          <p>
            This site is a fan-made community project, made possible by the work of developers in
            the JK2 and JKA community, and a host of AI tools. I am a complete beginner to coding
            and web dev, and simply embarked on this vibecoded project to serve the small
            40-player community of JK2 CTF.
          </p>

          <p>
            What started out as a simple team balancer to avoid one-sided games has transformed
            into a database for player stats, match stats, and demo clips. This is largely thanks
            to <Ext href="https://github.com/TomArrow">TomArrow</Ext>, whose JK2 Watcher bots
            (Pidiwins in-game) record entire games, player stats and clips (via “!markme” in
            gamechat). He publishes and archives these diligently for the community. Thank you to
            Tom for sharing the resources you made with the community and working with me to
            ensure we could upload them to the site.
          </p>

          <p>
            The player stats panels and in-browser demo viewer are inspired heavily by
            Loda&apos;s work on <Ext href="https://playja.pro">playja.pro</Ext>. After seeing how
            impressive and comprehensive the resources are on that website, some players wanted
            the same offering for JK2. It&apos;s much more impressive than what AI has achieved
            on this site, and I urge you to visit it. Thank you, Loda, for building it and
            inspiring us JK2ers.
          </p>

          <p>
            The demo viewer is a modded version of{" "}
            <Ext href="https://github.com/mvdevs/jk2mv">JK2MV</Ext>, which was proven possible by{" "}
            <Ext href="https://github.com/pdewilde/openjk-wasm">pdewilde&apos;s openjk-wasm</Ext>.
            Pdewilde&apos;s platform allows users to play JKA in-browser with game assets, and
            that approach pretty much made the JK2MV browser port possible here. Massive thank
            you to them, and to the JK2MV and{" "}
            <Ext href="https://github.com/JACoders/OpenJK">OpenJK</Ext>{" "}developers. Without them,
            this game and JKA would unlikely still have active players.
          </p>

          <p>
            The engine&apos;s classic OpenGL rendering reaches WebGL through{" "}
            <Ext href="https://github.com/ptitSeb/gl4es">GL4ES</Ext>{" "}by ptitSeb, which grew from
            Ryan Hileman&apos;s{" "}
            <Ext href="https://github.com/lunixbochs/glshim">glshim</Ext>. Our performance work
            for this site lives as patches on top of it. The engine modifications on this site
            are, like everything they build on, GPLv2. The modified source is published on{" "}
            <Ext href="https://github.com/soradozere">Github</Ext>. The game assets are not part
            of any of these repositories and never will be.
          </p>

          <p className="text-sm text-text-dim">
            This site is not affiliated with Raven Software, Activision or LucasArts.
          </p>
        </div>
      </div>
    </div>
  )
}
