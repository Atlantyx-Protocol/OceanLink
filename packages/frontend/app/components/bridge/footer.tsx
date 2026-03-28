import Link from "next/link"
import { Twitter, Github, MessageCircle } from "lucide-react"

export function Footer() {
  return (
    <footer className="px-4 py-6 md:px-6">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-6">
          <Link href="#" className="hover:text-foreground transition-colors">
            FAQ
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <div className="flex items-center gap-4">
            <Link href="#" className="hover:text-foreground transition-colors">
              <Twitter className="h-4 w-4" />
            </Link>
            <Link href="#" className="hover:text-foreground transition-colors">
              <Github className="h-4 w-4" />
            </Link>
            <Link href="#" className="hover:text-foreground transition-colors">
              <MessageCircle className="h-4 w-4" />
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <Link href="#" className="hover:text-foreground transition-colors">
            Terms
          </Link>
          <Link href="#" className="hover:text-foreground transition-colors">
            Privacy
          </Link>
        </div>
      </div>
      <div className="mt-4 text-center text-xs text-muted-foreground/60">
        Powered by OceanLink Protocol
      </div>
    </footer>
  )
}
