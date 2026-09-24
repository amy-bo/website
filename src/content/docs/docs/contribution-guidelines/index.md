---
title: Contribution Guidelines
description: How to contribute to the AMYBO community
source: hugo
hugoPath: /docs/contribution-guidelines/
provenance: "'Reach out to us' and 'Editing AMYBO.org' are verbatim from Hugo. 'Web stack' onwards is new, replacing the Hugo, Docsy and Netlify instructions for the Astro site."
sidebar:
  order: 999
---

## Reach out to us

Please add a comment to one of [our YouTube videos](https://www.youtube.com/@AMYBO) or drop us a line at <hello@AMYBO.org> with any suggestions or questions you may have - or just to say hello, it's good to know people are reading this.

If you're comfortable with GitHub (or would like to learn) we'd absolutely love it if you were happy to dive in and edit our pages directly:

## Editing AMYBO.org

We welcome contributions and improvements to the AMYBO.org website.  We want this to be as easy as possible so considered a wiki.  However, given the controversial nature and risks associated with protein production for human consumption, we decided that an approvals process was required.

Since we'll be using GitHub for software development, and potentially also for hardware and procedure development, it made sense to use this for community development of the website.  If you struggle at all with GitHub development, please get in touch via <hello@AMYBO.org>

### Web stack

We use [Astro](https://astro.build/) with the [Starlight](https://starlight.astro.build/) documentation theme to build the website, and [Cloudflare Pages](https://pages.cloudflare.com/) to host it. You write pages in Markdown (or MDX when a page needs a component), and Astro turns them into a website. The code lives in the [amy-bo/website](https://github.com/amy-bo/website) repository.

All submissions, including submissions by project members, require review. We use GitHub pull requests for this purpose. Consult [GitHub Help](https://docs.github.com/en/pull-requests) for more information on using pull requests.

### Updating a single page

If you've just spotted something you'd like to change:

1. Click **Edit page** at the bottom of the page.
1. GitHub asks you to fork the repository if you haven't already, then opens the page for editing.
1. Make your change and click **Propose changes**, then **Create pull request**.
1. Cloudflare Pages builds a preview of your pull request, so you and the reviewers can see the change before it goes live.

### Previewing your changes locally

1. Install [Node.js](https://nodejs.org/) 20 or later.
1. Fork [amy-bo/website](https://github.com/amy-bo/website), then clone your fork:

    ```
    git clone https://github.com/<your-username>/website
    cd website
    npm install
    npm run dev
    ```

1. Open [localhost:4321](http://localhost:4321/). The site reloads as you edit files in `src/content/docs/`.
1. Commit, push to your fork and open a pull request.

Each page's frontmatter has a `source:` field (`amy`, `hugo` or `new`) recording where its text came from; please leave it as it is when you edit a page.

### Creating an issue

If you've found a problem but you're not sure how to fix it yourself, please [create an issue](https://github.com/amy-bo/website/issues).

### Useful resources

* [Starlight documentation](https://starlight.astro.build/): how pages, the sidebar and components work.
* [Astro documentation](https://docs.astro.build/): comprehensive reference for Astro.
* [GitHub Hello World!](https://docs.github.com/en/get-started/start-your-journey/hello-world): a basic introduction to GitHub concepts and workflow.
