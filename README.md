# PMNIS - Prototyp rozhrania pre anotaciu 3D MRI snimok

Webova aplikacia na prezeranie, anotaciu a analyzu 3D MRI snimok mozgu s podporou AI detekcie.

GitHub repozitar: [https://github.com/SamNag/PMNIS.git](https://github.com/PMNIS/PMNIS)

## Poziadavky

- **Node.js** (verzia 18 alebo novsia) - [https://nodejs.org](https://nodejs.org)

Na overenie instalacie spustite v terminali:

```bash
node --version
npm --version
```

## Spustenie

1. Otvorte terminal v priecinku projektu

2. Nainstalujte vsetky potrebne kniznice (Vue, Tailwind, atd.):

```bash
npm install
```

   Tento prikaz automaticky stiahne vsetky zavislosti - nie je potrebne nic dalsie instalovat manualne.

3. Spustite aplikaciu:

```bash
npm run dev
```

4. Otvorte prehliadac na adrese: **http://localhost:5173**

## Funkcionalita

- **3D prehliadac MRI** - axialne, sagitalne a koronalne rezy + 3D vizualizacia (WebGL)
- **Anotacne nastroje** - stetec, guma, polygon, laso, obrys, vyplnenie
- **Vrstvovy system** - viacero vrstiev anotacii s nastavitelnou farbou
- **AI detekcia** - automaticka a poloautomaticka detekcia anomalii
- **Podpora formatov** - NIfTI (.nii, .nii.gz) a DICOM (.dcm)
