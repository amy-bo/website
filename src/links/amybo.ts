import type { LinkPage } from './types';

/** amy.bo/~amybo, replacing linktr.ee/amybo.org (links as on 2 October 2026). */
const page: LinkPage = {
	handle: 'amybo',
	name: 'AMYBO',
	bio: 'AMYBO is an open source protein fermentation community',
	sections: [
		{
			links: [
				{ slug: 'waitlist', label: 'Join the free bioreactor waitlist', url: 'https://amybo.us17.list-manage.com/subscribe?u=6f309c6b041857567b9962872&id=c1cd11b645', icon: 'mail' },
				{ slug: 'forum', label: 'Ask questions in our forum', url: 'https://forum.amybo.org/', icon: 'forum' },
				{ slug: 'youtube', label: 'Learn more on YouTube', url: 'https://www.youtube.com/@amybo', icon: 'youtube' },
				{ slug: 'website', label: 'Check out our website', url: 'https://amybo.org/', icon: 'amybo' },
				{ slug: 'github', label: 'Contribute on GitHub', url: 'https://github.com/amy-bo', icon: 'github' },
				{ slug: 'docs', label: 'Read our docs', url: 'https://amybo.org/docs', icon: 'docs' },
				{ slug: 'prints', label: 'Print our stuff', url: 'https://www.printables.com/@AMYBO_2001380', icon: 'print' },
				{ slug: 'contact', label: 'Contact us', url: 'https://contact.andeye.com/?source=amy.bo%2F~amybo&subject=Message%20from%20amy.bo&cb=Volunteering&cb=Running%20an%20experiment&cb=Building%20an%20electroPioreactor&cb=Funding%20or%20sponsorship&cb=Press%20or%20speaking&cb=Something%20else', icon: 'mail' },
			],
		},
		{
			title: 'People',
			links: [
				{ slug: 'martin', label: 'Martin', url: 'https://amy.bo/~martin', icon: 'person' },
				{ slug: 'martin-patreon', label: "Martin's Patreon", url: 'https://www.patreon.com/amybo', icon: 'patreon' },
				{ slug: 'gerrit-margriet', label: 'Gerrit and Margriet', url: 'https://labcrafter.co.uk/pages/about-us', icon: 'person' },
			],
		},
	],
};

export default page;
