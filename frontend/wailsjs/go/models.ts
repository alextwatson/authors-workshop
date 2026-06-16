export namespace main {
	
	export class ChapterInfo {
	    filename: string;
	    title: string;
	    wordCount: number;
	
	    static createFrom(source: any = {}) {
	        return new ChapterInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.title = source["title"];
	        this.wordCount = source["wordCount"];
	    }
	}
	export class FocusSettings {
	    dimSentences: boolean;
	    typewriter: boolean;
	    dimTitle: boolean;
	    hideWordCount: boolean;
	    dimSentencesAlways: boolean;
	    typewriterAlways: boolean;
	    dimTitleAlways: boolean;
	    hideWordCountAlways: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FocusSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dimSentences = source["dimSentences"];
	        this.typewriter = source["typewriter"];
	        this.dimTitle = source["dimTitle"];
	        this.hideWordCount = source["hideWordCount"];
	        this.dimSentencesAlways = source["dimSentencesAlways"];
	        this.typewriterAlways = source["typewriterAlways"];
	        this.dimTitleAlways = source["dimTitleAlways"];
	        this.hideWordCountAlways = source["hideWordCountAlways"];
	    }
	}
	export class GitCommitInfo {
	    hash: string;
	    date: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new GitCommitInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.date = source["date"];
	        this.message = source["message"];
	    }
	}
	export class GitHubLogin {
	    userCode: string;
	    verificationUri: string;
	    deviceCode: string;
	    interval: number;
	
	    static createFrom(source: any = {}) {
	        return new GitHubLogin(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.userCode = source["userCode"];
	        this.verificationUri = source["verificationUri"];
	        this.deviceCode = source["deviceCode"];
	        this.interval = source["interval"];
	    }
	}
	export class GitState {
	    available: boolean;
	    isRepo: boolean;
	    branch: string;
	    hasRemote: boolean;
	    remoteUrl: string;
	    dirty: boolean;
	    changeCount: number;
	    ahead: number;
	    behind: number;
	    signedIn: boolean;
	    githubUser: string;
	
	    static createFrom(source: any = {}) {
	        return new GitState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.isRepo = source["isRepo"];
	        this.branch = source["branch"];
	        this.hasRemote = source["hasRemote"];
	        this.remoteUrl = source["remoteUrl"];
	        this.dirty = source["dirty"];
	        this.changeCount = source["changeCount"];
	        this.ahead = source["ahead"];
	        this.behind = source["behind"];
	        this.signedIn = source["signedIn"];
	        this.githubUser = source["githubUser"];
	    }
	}
	export class ManuscriptPart {
	    id: string;
	    label: string;
	    before: string;
	
	    static createFrom(source: any = {}) {
	        return new ManuscriptPart(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.before = source["before"];
	    }
	}
	export class ProjectMeta {
	    name: string;
	    author: string;
	    description: string;
	    wordCountGoal: number;
	    dailyWordGoal: number;
	    createdAt: string;
	    updatedAt: string;
	    focus?: FocusSettings;
	    manuscriptFormat: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.author = source["author"];
	        this.description = source["description"];
	        this.wordCountGoal = source["wordCountGoal"];
	        this.dailyWordGoal = source["dailyWordGoal"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.focus = this.convertValues(source["focus"], FocusSettings);
	        this.manuscriptFormat = source["manuscriptFormat"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Project {
	    path: string;
	    meta: ProjectMeta;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.meta = this.convertValues(source["meta"], ProjectMeta);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TrashItem {
	    id: string;
	    kind: string;
	    filename: string;
	    title: string;
	    projectPath: string;
	
	    static createFrom(source: any = {}) {
	        return new TrashItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.filename = source["filename"];
	        this.title = source["title"];
	        this.projectPath = source["projectPath"];
	    }
	}

}

