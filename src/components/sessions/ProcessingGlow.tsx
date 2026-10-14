/**
 * Glow ala Siri di dasar layar Session selama model memproses balasan.
 *
 * - Murni dekoratif: `aria-hidden` + tanpa pointer — status untuk pembaca
 *   layar tetap datang dari `Mascot` (role="status") di timeline.
 * - Masuk/keluar memudar lewat motion lalu dilepas dari DOM, jadi animasi
 *   terus-menerusnya tidak berjalan saat idle.
 * - Gerakan terus-menerus (aliran warna + "napas") ada di CSS
 *   `.processing-glow*` (styles/globals.css).
 * - `-z-10` di dalam induk yang `isolate`: glow tergambar di atas latar
 *   halaman tetapi DI BELAKANG seluruh isi Session — teks timeline tetap
 *   tajam dan kotak composer tampak menyala dari belakang.
 */
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

export function ProcessingGlow({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <m.div
          key="processing-glow"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // Keluar lebih pelan dari masuk: glow "meredup" setelah balasan
          // selesai, bukan padam mendadak.
          exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeOut" } }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="processing-glow pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 overflow-hidden"
        >
          <div className="processing-glow__layer processing-glow__haze" />
          <div className="processing-glow__layer processing-glow__blobs" />
          <div className="processing-glow__layer processing-glow__edge" />
        </m.div>
      )}
    </AnimatePresence>
  );
}
