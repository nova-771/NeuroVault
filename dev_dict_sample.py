"""
Dev only (Build J): a small Open English WordNet sample in the real release's format (WN-LMF XML, gzipped), so the
dictionary's download, build and search can be tried without the real 12.9 MB file.

    python dev_dict_sample.py --out <folder> [--serve 8797]

writes <folder>/english-wordnet-sample.xml.gz and <folder>/dict_list.json pointing at http://127.0.0.1:<port>/,
and with --serve keeps a local HTTP server running for the file (Ctrl+C stops it). Then:

    python dev_bridge.py --db <scratch db> --config <scratch config> --dict-list <folder>/dict_list.json

The words are the mockup's (R37) sample words, written by hand: they are not taken from WordNet.
"""
import argparse
import gzip
import hashlib
import json
import os
from xml.sax.saxutils import quoteattr, escape

# word: (part of speech, [(meaning, example)], similar words, opposites, other forms)
SAMPLE = {
    "consolidate": ("v", [("Combine several things into one stronger, simpler whole.", "We consolidated three to-do lists into one."),
                          ("Make something firmer or more secure.", "Regular practice consolidates what you learn.")], ["combine", "unify", "merge", "strengthen"], ["divide", "weaken"], []),
    "consolation": ("n", [("Comfort for someone who is sad or disappointed.", "Her kind note was a real consolation.")], ["comfort", "solace"], ["distress"], []),
    "console": ("v", [("Give comfort to someone who is sad.", "She consoled her friend after the exam.")], ["comfort", "soothe"], [], []),
    "combine": ("v", [("Join or mix two or more things together.", "Combine the notes into one page.")], ["join", "merge", "mix", "unite"], ["separate"], []),
    "merge": ("v", [("Join two things so they become one.", "Merge the two branches before Friday.")], ["fuse", "blend"], ["split"], []),
    "roadmap": ("n", [("A plan that shows the steps and dates toward a goal.", "The Q3 roadmap lists four milestones."),
                      ("A map that shows the roads of an area.", "")], ["plan", "schedule", "blueprint"], [], []),
    "milestone": ("n", [("An important point or event in a project.", "Shipping the beta is our next milestone."),
                        ("A stone by a road that shows the distance in miles.", "")], ["landmark", "checkpoint"], [], []),
    "draft": ("n", [("An early version that will change.", "Send me the first draft by Friday.")], ["sketch", "outline"], [], []),
    "draught": ("n", [("A flow of cold air into a room.", "Close the window, there's a draught.")], ["breeze"], [], []),
    "freeze": ("v", [("Turn to ice, or become very cold.", "The pond froze overnight."), ("Stop changes for a time.", "The code freeze starts on Monday.")],
               ["halt", "lock"], ["thaw"], ["froze", "frozen"]),
    "conflict": ("n", [("A clash between two versions or ideas.", "Two devices made a sync conflict.")], ["clash", "collision"], ["agreement", "harmony"], []),
    "resolution": ("n", [("The way a problem is settled.", "Conflict resolution keeps both versions."), ("How sharp an image or screen is.", "A high-resolution screenshot.")],
                   ["solution", "answer"], [], []),
    "affect": ("v", [("Change or influence something.", "Noise affects my focus.")], ["influence", "impact"], [], []),
    "effect": ("n", [("A result or change caused by something.", "The new theme had a calming effect.")], ["result", "outcome"], ["cause"], []),
    "quiet": ("a", [("Making little or no noise.", "A quiet room helps me read.")], ["silent", "calm"], ["loud", "noisy"], []),
    "quite": ("r", [("Fairly, or to a certain amount.", "The page feels quite calm.")], ["fairly", "rather"], [], []),
    "receive": ("v", [("Get something that is given or sent to you.", "Beta readers will receive the build on Friday.")], ["get", "accept"], ["send", "give"], []),
    "separate": ("a", [("Apart, not joined or together.", "Keep the two notes separate.")], ["apart", "distinct"], ["joined"], []),
    "definitely": ("r", [("Without any doubt.", "I'll definitely finish it today.")], ["certainly", "surely"], [], []),
    "focus": ("n", [("The thing you give your attention to.", "My focus today is the pipeline.")], ["attention", "centre"], ["distraction"], []),
    "pipeline": ("n", [("A long pipe that carries oil, gas or water a long way.", "A gas pipeline runs under the sea.")], ["conduit"], [], []),
    "accept": ("v", [("Say yes to something offered.", "Accept the meeting invite.")], ["take"], ["refuse", "reject"], []),
    "except": ("p", [("Apart from; not including.", "Every task except the last is done.")], ["but"], [], []),
    "whole": ("a", [("All of something, with nothing missing.", "I read the whole chapter.")], ["entire", "complete"], ["partial"], []),
    "hole": ("n", [("An empty space or gap in something.", "There's a hole in the plan.")], ["gap", "opening"], [], []),
    "course": ("n", [("A series of lessons in one subject.", "The data engineering course runs for ten weeks.")], ["class"], [], []),
    "lecture": ("n", [("A talk given to teach a group, often part of a course.", "The lecture covers pipelines.")], ["talk"], [], []),
}


# near-synonyms an adjective links through a "similar" relation (as WordNet does for beautiful → lovely)
SIMILAR = {"quiet": ("peaceful", "Not disturbed by noise or worry.")}


def make_sample(path, pad=0):
    """Writes the sample as WN-LMF XML, gzipped, at path. Returns {bytes, sha256}. pad adds that many random
    characters in a comment (they don't compress), for a download slow enough to cancel in the tests."""
    entries, synsets, members = {}, [], {}
    sid_of = {}

    def entry(w, pos):
        return entries.setdefault((w, pos), {"senses": [], "forms": []})

    for w, (pos, senses, syn, ant, forms) in SAMPLE.items():
        e = entry(w, pos)
        e["forms"] += forms
        for i, (d, ex) in enumerate(senses):
            sid = f"sample-{len(synsets) + 1:08d}-{pos}"
            synsets.append((sid, pos, d, ex))
            sid_of[(w, i)] = sid
            e["senses"].append({"id": f"sample-{w}%{i}", "synset": sid, "ant": []})
            if i == 0:
                for s in syn:
                    entry(s, pos)["senses"].append({"id": f"sample-{s}%{w}", "synset": sid, "ant": []})
        for a in ant:   # an opposite: its own synset unless it is a sample word
            if a in SAMPLE:
                target = f"sample-{a}%0"
            else:
                sid = f"sample-{len(synsets) + 1:08d}-{pos}"
                synsets.append((sid, pos, f"The opposite of {w}.", ""))
                target = f"sample-{a}%ant"
                entry(a, pos)["senses"].append({"id": target, "synset": sid, "ant": []})
            e["senses"][0]["ant"].append(target)
    similar = []
    for w, (other, d) in SIMILAR.items():
        sid = f"sample-{len(synsets) + 1:08d}-s"
        synsets.append((sid, "s", d, ""))
        entry(other, "s")["senses"].append({"id": f"sample-{other}%sim", "synset": sid, "ant": []})
        similar.append((sid_of[(w, 0)], sid))
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE LexicalResource SYSTEM "http://globalwordnet.github.io/schemas/WN-LMF-1.3.dtd">',
           '<LexicalResource xmlns:dc="https://globalwordnet.github.io/schemas/dc/">',
           '  <Lexicon id="sample" label="NeuroVault test sample" language="en" email="dev@example.org" license="https://creativecommons.org/licenses/by/4.0/" version="2024" url="https://example.org/">']
    for (w, pos), e in entries.items():
        out.append(f'    <LexicalEntry id={quoteattr("sample-" + w.replace(" ", "_") + "-" + pos)}>')
        out.append(f'      <Lemma writtenForm={quoteattr(w)} partOfSpeech="{pos}"/>')
        for f in e["forms"]:
            out.append(f'      <Form writtenForm={quoteattr(f)}/>')
        for s in e["senses"]:
            rels = "".join(f'\n        <SenseRelation relType="antonym" target={quoteattr(t)}/>' for t in s["ant"])
            out.append(f'      <Sense id={quoteattr(s["id"])} synset="{s["synset"]}">{rels}{chr(10) + "      " if rels else ""}</Sense>')
        out.append('    </LexicalEntry>')
    for sid, pos, d, ex in synsets:
        out.append(f'    <Synset id="{sid}" ili="" partOfSpeech="{pos}">')
        out.append(f'      <Definition>{escape(d)}</Definition>')
        if ex:
            out.append(f'      <Example>"{escape(ex)}"</Example>')
        out += [f'      <SynsetRelation relType="similar" target="{b}"/>' for a, b in similar if a == sid]
        out.append('    </Synset>')
    if pad:
        out.append("    <!-- " + os.urandom(pad // 2).hex() + " -->")
    out += ['  </Lexicon>', '</LexicalResource>', '']
    data = gzip.compress("\n".join(out).encode("utf-8"), mtime=0)
    with open(path, "wb") as f:
        f.write(data)
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def sample_list(file_info, url, file="english-wordnet-sample.xml.gz"):
    return {"updated": "2026-10-16", "dictionaries": [{
        "id": "oewn-sample", "name": "Open English WordNet (test sample)", "short": "WordNet sample", "version": "2025", "file": file, "url": url,
        **file_info, "disk_mb": 1, "words": "about 70", "licence": "CC BY 4.0", "licence_url": "https://creativecommons.org/licenses/by/4.0/",
        "source": "a local test server", "source_url": "https://en-word.net/",
        "attribution": "A hand-written test sample in Open English WordNet's format (not WordNet data)."}]}


def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--serve", type=int, help="serve the folder on this port")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    name = "english-wordnet-sample.xml.gz"
    info = make_sample(os.path.join(a.out, name))
    port = a.serve or 8797
    with open(os.path.join(a.out, "dict_list.json"), "w", encoding="utf-8") as f:
        json.dump(sample_list(info, f"http://127.0.0.1:{port}/{name}"), f, indent=2)
    print("Wrote", name, info, flush=True)
    if a.serve:
        import functools
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        ThreadingHTTPServer(("127.0.0.1", port), functools.partial(SimpleHTTPRequestHandler, directory=a.out)).serve_forever()


if __name__ == "__main__":
    main()
