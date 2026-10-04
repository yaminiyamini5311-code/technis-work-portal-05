class Performance {

    constructor(data) {

        this.id = data.id;
        this.user_id = data.user_id;
        this.period = data.period;
        this.score = data.score;
        this.strengths = data.strengths;
        this.improvements = data.improvements;
        this.completed_missions = data.completed_missions;
        this.feedback = data.feedback;
        this.reviewed_by = data.reviewed_by;

    }

}

module.exports = Performance;