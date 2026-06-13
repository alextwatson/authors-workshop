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

